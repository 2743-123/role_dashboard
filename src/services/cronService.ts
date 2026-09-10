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
  // 🕒 3:00 PM (15:00) aur 4:00 PM (16:00) ke liye set
  cron.schedule("0 15,16 * * *", async () => {
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

        if (pendingBedashes.length === 0) {
          console.log(`ℹ️ No pending bedash for Admin: ${admin.name}. Skipping message.`);
          continue;
        }

        // Batch Fetching: In sabhi users ke Material Accounts ek sath nikal lein
        const userIds = [...new Set(pendingBedashes.map(b => b.user.id))];
        const accounts = await accountRepo.find({
          where: { user: { id: In(userIds) } },
          relations: ["user"]
        });

        const instanceId = admin.whatsappInstanceId;
        const token = admin.whatsappToken;

        // 🟢 3. Admin ka Message Format tayar karein
        let adminMessageText = `📋 *Scheduled Bedash Report* 📋\n\n`;
        adminMessageText += `Hello *${admin.name}*,\nHere are the pending records for your users:\n\n`;
        let adminIndex = 1;

        // Customers ke records unke number ke hisaab se group karne ke liye Map banayenge
        const customerTasksMap = new Map<string, any[]>();

        for (const b of pendingBedashes) {
          const userAccount = accounts.find(
            a => a.user.id === b.user.id && a.materialType === b.materialType
          );
          const remainingTons = userAccount ? Number(userAccount.remainingTons).toFixed(3) : "0.000";

          // 👉 3a. Admin ke message me sabhi (eg. 4) items add honge
          adminMessageText += `${adminIndex}. User: *${b.user?.name}*\n` +
            `   - Material: ${b.materialType}\n` +
            `   - Amount: ${b.amount}\n` +
            `   - Target Date: ${b.targetDate}\n` +
            `   - ⚖️ Remaining: *${remainingTons} Tons*\n\n`; 
          adminIndex++;

          // 👉 3b. Customer ka record uske number ke aage save karein
          if (b.reminderPhone) {
            const phone = b.reminderPhone.trim();
            if (!customerTasksMap.has(phone)) {
              customerTasksMap.set(phone, []);
            }
            customerTasksMap.get(phone)!.push({
              userName: b.user?.name,
              materialType: b.materialType,
              amount: b.amount,
              targetDate: b.targetDate,
              remainingTons: remainingTons
            });
          }
        }

        adminMessageText += `- Bricks Admin System`;

        // 4. Messages Send Karne Ki Baari
        
        // 👉 A. Admin ko Final List bhejein
        const adminPhone = admin.phone; 
        if (adminPhone && instanceId && token) {
          try {
            await axios.post(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
              token: token,
              to: adminPhone,
              body: adminMessageText,
            });
            console.log(`✅ Full Bedash report sent to Admin: ${adminPhone}`);
          } catch (waErr) {
            console.error(`❌ Admin WhatsApp delivery failed for: ${adminPhone}`, waErr);
          }
        }

        // 👉 B. Har Customer ko EXACT SAME FORMAT me uske (eg. 3) records bhejein
        if (instanceId && token) {
          for (const [phone, tasks] of customerTasksMap.entries()) {
            
            // 🟢 YAHAN CHANGE KIYA HAI: Hello *User* permanent kar diya gaya hai
            let customerMsg = `📋 *Scheduled Bedash Report* 📋\n\n`;
            customerMsg += `Hello *User*,\nHere are the pending records:\n\n`;
            
            let custIndex = 1;
            for (const task of tasks) {
              customerMsg += `${custIndex}. User: *${task.userName}*\n` +
                `   - Material: ${task.materialType}\n` +
                `   - Amount: ${task.amount}\n` +
                `   - Target Date: ${task.targetDate}\n` +
                `   - ⚖️ Remaining: *${task.remainingTons} Tons*\n\n`;
              custIndex++;
            }
            customerMsg += `- Bricks Admin System`;

            // Customer ko send karein
            try {
              await axios.post(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
                token: token,
                to: phone,
                body: customerMsg,
              });
              console.log(`✅ Personal Bedash report sent to Customer: ${phone}`);
            } catch (err) {
              console.error(`❌ Customer WhatsApp delivery failed for: ${phone}`);
            }
          }
        }

      }
    } catch (error) {
      console.error("❌ Error in Bedash Cron Job:", error);
    }
  }, {
    timezone: "Asia/Kolkata" 
  });
};