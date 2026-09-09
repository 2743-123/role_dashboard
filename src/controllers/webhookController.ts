import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { MaterialAccount } from "../models/materialaccount";
import { generateAndSendUserReportPDF } from "../services/whatappSendServices";

const userRepo = AppDataSource.getRepository(User);
const tokenRepo = AppDataSource.getRepository(Token);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  try {
    console.log("🔔 WEBHOOK HIT DATA:", JSON.stringify(req.body, null, 2)); // 👈 Ise add karein
    const webhookData = req.body;
    

    if (webhookData && webhookData.data) {
      const message = webhookData.data;
      const senderPhone = message.from?.replace("@c.us", "").replace("+", "");
      const messageBody = message.body?.trim().toLowerCase();

      if (senderPhone && (messageBody === "hi" || messageBody === "hello" || messageBody === "report")) {
        
        // 1. Pehle check karein kya yeh number kisi Token me customerPhone ke roop me save hai?
        const matchingToken = await tokenRepo.findOne({
          where: [{ customerPhone: senderPhone }, { customerPhone: `+${senderPhone}` }],
          relations: ["user", "user.creator"],
          order: { id: "DESC" }
        });

        if (matchingToken) {
          const customerName = matchingToken.customerName;
          const assignedUser = matchingToken.user; // Jis user/dealer ke under token bana tha

          // Us user ke saare tokens nikal lein jo is customer ke hain ya us user ke paas hain
          const customerTokens = await tokenRepo.find({
            where: [
              { customerPhone: senderPhone }, 
              { customerPhone: `+${senderPhone}` }
            ],
            order: { id: "DESC" },
          });

          // Material accounts fetch karein
          const accounts = await accountRepo.find({
            where: { user: { id: assignedUser.id } },
          });

          const adminUser = assignedUser.role === "user" ? assignedUser.creator : assignedUser;

          // Dummy user object banakar PDF generate karein jisme customer ka naam ho
          const reportUser = {
            id: assignedUser.id,
            name: customerName,
            email: assignedUser.email || "customer@bricks.com",
          };

          // PDF generate karke customer ke WhatsApp par bhej dein
          await generateAndSendUserReportPDF(reportUser, customerTokens, accounts, {
            instanceId: (adminUser as any)?.whatsappInstanceId,
            token: (adminUser as any)?.whatsappToken,
            phone: senderPhone,
          });

          console.log(`✅ Auto PDF token report sent to Customer: ${customerName} (${senderPhone})`);
        } else {
          // 2. Agar token me nahi mila, toh User/Dealer ke khud ke number se check karein
          const user = await userRepo.findOne({
            where: [{ phone: senderPhone }, { phone: `+${senderPhone}` }],
            relations: ["creator"],
          });

          if (user) {
            const tokens = await tokenRepo.find({
              where: { user: { id: user.id } },
              order: { id: "DESC" },
            });

            const accounts = await accountRepo.find({
              where: { user: { id: user.id } },
            });

            const adminUser = user.role === "user" ? user.creator : user;

            await generateAndSendUserReportPDF(user, tokens, accounts, {
              instanceId: (adminUser as any)?.whatsappInstanceId,
              token: (adminUser as any)?.whatsappToken,
              phone: senderPhone,
            });

            console.log(`✅ Auto PDF report sent to Dealer: ${user.name} (${senderPhone})`);
          }
        }
      }
    }

    return res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: "Webhook failed" });
  }
};