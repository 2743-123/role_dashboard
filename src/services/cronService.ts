import cron from "node-cron";
import { In } from "typeorm";
import { AppDataSource } from "../config/db";
import { BedashMessage } from "../models/bedashMessage";
import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import axios from "axios";

const bedashRepo = AppDataSource.getRepository(BedashMessage);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

export const initBedashScheduler = () => {
  // Roz dopahar 3:00 PM ke liye: "0 15 * * *"
  cron.schedule("0 15 * * *", async () => {
    try {
      console.log("⏰ Running Scheduled Bedash WhatsApp Reminder Task...");

      // 1. Database se saare Admin aur Superadmin nikal lein
      const admins = await userRepo.find({
        where: [
          { role: "admin" },
          { role: "superadmin" }
        ]
      });

      // 2. Har Admin ke liye loop chalayein
      for (const admin of admins) {
        const pendingBedashes = await bedashRepo.find({
          where: {
            status: "pending",
            user: { creator: { id: admin.id } } // Admin ke users filter
          },
          relations: ["user"],
          order: { targetDate: "ASC" }, 
        });

        if (pendingBedashes.length === 0) continue;

        // Batch Fetching: In sabhi users ke Material Accounts ek sath nikal lein
        const userIds = [...new Set(pendingBedashes.map(b => b.user.id))];
        const accounts = await accountRepo.find({
          where: { user: { id: In(userIds) } },
          relations: ["user"]
        });

        // 3. Message Format Karein
        let messageText = `📋 *Scheduled Bedash Report (3:00 PM)* 📋\n\n`;
        messageText += `Hello *${admin.name}*,\nHere are the pending records for your users:\n\n`;

        pendingBedashes.forEach((b, index) => {
          // Is specific user ka specific material balance dhundhein
          const userAccount = accounts.find(
            a => a.user.id === b.user.id && a.materialType === b.materialType
          );
          const remainingTons = userAccount ? Number(userAccount.remainingTons).toFixed(3) : "0.000";

          messageText += `${index + 1}. User: *${b.user?.name}*\n` +
            `   - Material: ${b.materialType}\n` +
            `   - Amount: ${b.amount}\n` +
            `   - Target Date: ${b.targetDate}\n` +
            `   - ⚖️ Remaining: *${remainingTons} Tons*\n\n`; // 👈 Naya Add Kiya Hua Line
        });

        // 4. Message Send Karein
        const adminPhone = admin.phone; 
        const instanceId = admin.whatsappInstanceId;
        const token = admin.whatsappToken;

        if (adminPhone && instanceId && token) {
          try {
            await axios.post(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
              token: token,
              to: adminPhone,
              body: messageText,
            });
            console.log(`✅ Bedash report (with remaining tons) successfully sent to Admin: ${admin.name} (${adminPhone})`);
          } catch (waErr) {
            console.error(`❌ WhatsApp delivery failed for Admin ${admin.name}:`, waErr);
          }
        } else {
          console.log(`⚠️ Admin ${admin.name} is missing phone number or WhatsApp credentials.`);
        }
      }
    } catch (error) {
      console.error("❌ Error in Bedash Cron Job:", error);
    }
  });
};