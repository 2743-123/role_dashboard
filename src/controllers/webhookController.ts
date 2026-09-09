import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { MaterialAccount } from "../models/materialaccount";
import { generateAndSendUserReportPDF } from "../services/whatappSendServices";

const tokenRepo = AppDataSource.getRepository(Token);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  try {
    const webhookData = req.body;

    if (webhookData && webhookData.data) {
      const message = webhookData.data;
      const senderPhone = message.from?.replace("@c.us", "").replace("+", "");
      const messageBody = message.body?.trim().toLowerCase();

      console.log(`incoming message from ${senderPhone}: "${messageBody}"`);

      if (senderPhone && (messageBody === "hi" || messageBody === "hello" || messageBody === "report")) {
        
        // 1. QueryBuilder se check karein ki kya yeh phone number kisi Token me customerPhone hai
        const matchingToken = await tokenRepo.createQueryBuilder("token")
          .leftJoinAndSelect("token.user", "user")
          .leftJoinAndSelect("user.creator", "creator")
          .where("token.customerPhone = :phone OR token.customerPhone = :plusPhone", {
            phone: senderPhone,
            plusPhone: `+${senderPhone}`
          })
          .orderBy("token.id", "DESC")
          .getOne();

        if (matchingToken) {
          const customerName = matchingToken.customerName;
          const assignedUser = matchingToken.user; 

          // Saare tokens nikal lein is customer ke liye
          const customerTokens = await tokenRepo.createQueryBuilder("token")
            .where("token.customerPhone = :phone OR token.customerPhone = :plusPhone", {
              phone: senderPhone,
              plusPhone: `+${senderPhone}`
            })
            .orderBy("token.id", "DESC")
            .getMany();

          const accounts = await accountRepo.find({
            where: { user: { id: assignedUser.id } },
          });

          const adminUser = assignedUser.role === "user" ? assignedUser.creator : assignedUser;

          const reportUser = {
            id: assignedUser.id,
            name: customerName,
            email: assignedUser.email || "customer@bricks.com",
          };

          await generateAndSendUserReportPDF(reportUser, customerTokens, accounts, {
            instanceId: (adminUser as any)?.whatsappInstanceId,
            token: (adminUser as any)?.whatsappToken,
            phone: senderPhone,
          });

          console.log(`✅ Auto PDF token report sent to Customer: ${customerName} (${senderPhone})`);
          return res.status(200).json({ status: "success", sentTo: "customer" });
        } else {
          // 2. QueryBuilder se User/Dealer check karein
          const user = await userRepo.createQueryBuilder("user")
            .leftJoinAndSelect("user.creator", "creator")
            .where("user.phone = :phone OR user.phone = :plusPhone", {
              phone: senderPhone,
              plusPhone: `+${senderPhone}`
            })
            .getOne();

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
            return res.status(200).json({ status: "success", sentTo: "dealer" });
          } else {
            console.log(`❌ Phone number ${senderPhone} not found in database tokens or users.`);
          }
        }
      }
    }

    return res.status(200).json({ status: "ignored" });
  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(500).json({ error: "Webhook failed" });
  }
};