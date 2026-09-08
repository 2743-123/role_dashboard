import { Request, Response } from "express";
import { google } from "googleapis";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { MaterialAccount } from "../models/materialaccount";
import { PaymentHistory } from "../models/PaymentHistory";
import { Transaction } from "../models/Transaction";
import stream from "stream";

// 🔹 BACKUP EXPORT TO GOOGLE DRIVE
export const exportBackup = async (req: Request, res: Response) => {
  try {
    const { googleToken } = req.body;
    if (!googleToken) return res.status(400).json({ msg: "Google Token is missing" });

    // Setup Google Drive Auth
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Fetch all database data (transactions ko bhi include kar liya hai)
    const backupData = {
      users: await AppDataSource.getRepository(User).find({ relations: ["creator"] }),
      tokens: await AppDataSource.getRepository(Token).find({ relations: ["user"] }),
      materialAccounts: await AppDataSource.getRepository(MaterialAccount).find({ relations: ["user"] }),
      paymentHistory: await AppDataSource.getRepository(PaymentHistory).find({ relations: ["user", "admin"] }),
      transactions: await AppDataSource.getRepository(Transaction).find(),
    };

    // Convert data to JSON stream
    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(JSON.stringify(backupData)));

    const fileMetadata = { name: "bricks_admin_backup.json", mimeType: "application/json" };
    const media = { mimeType: "application/json", body: bufferStream };

    // Upload to Google Drive (Agar purani file hai toh overwrite/update ya nayi create karega)
    await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id",
    });

    return res.json({ msg: "✅ Backup successfully saved to Google Drive" });
  } catch (err) {
    console.error("Backup Error:", err);
    return res.status(500).json({ msg: "Server error during backup" });
  }
};

// 🔹 RESTORE IMPORT FROM GOOGLE DRIVE
export const importBackup = async (req: Request, res: Response) => {
  try {
    const { googleToken } = req.body;
    if (!googleToken) return res.status(400).json({ msg: "Google Token is missing" });

    // Setup Google Drive Auth
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Find the latest backup file in Drive
    const response = await drive.files.list({
      q: "name='bricks_admin_backup.json'",
      spaces: "drive",
      orderBy: "createdTime desc",
      pageSize: 1,
    });

    const files = response.data.files;
    if (!files || files.length === 0) {
      return res.status(404).json({ msg: "❌ No backup file found in your Google Drive" });
    }

    const fileId = files[0].id!;

    // Download file content
    const file = await drive.files.get({ fileId: fileId, alt: "media" }, { responseType: "json" });
    const backupData: any = file.data;

    if (!backupData || !backupData.users) {
      return res.status(400).json({ msg: "Invalid backup file format" });
    }

    // ⭐ Restore Data to Database using PostgreSQL CASCADE Truncate
    await AppDataSource.transaction(async (manager) => {
      // Foreign key constraints bypass karne ke liye TRUNCATE CASCADE use karein
      await manager.query(`TRUNCATE TABLE "payment_history" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "material_account" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "token" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "transaction" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "user" RESTART IDENTITY CASCADE;`);

      // RESTORE DATA IN PROPER ORDER
      if (backupData.users?.length > 0) {
        await manager.getRepository(User).save(backupData.users);
      }
      if (backupData.transactions?.length > 0) {
        await manager.getRepository(Transaction).save(backupData.transactions);
      }
      if (backupData.materialAccounts?.length > 0) {
        await manager.getRepository(MaterialAccount).save(backupData.materialAccounts);
      }
      if (backupData.tokens?.length) {
        await manager.getRepository(Token).save(backupData.tokens);
      }
      if (backupData.paymentHistory?.length > 0) {
        await manager.getRepository(PaymentHistory).save(backupData.paymentHistory);
      }
    });

    return res.json({ msg: "✅ Database successfully restored from Google Drive!" });
  } catch (err) {
    console.error("Restore Error:", err);
    return res.status(500).json({ msg: "Server error during restore" });
  }
};