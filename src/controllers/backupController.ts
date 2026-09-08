import { Request, Response } from "express";
import { google } from "googleapis";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { MaterialAccount } from "../models/materialaccount";
import { PaymentHistory } from "../models/PaymentHistory";
import stream from "stream";
import { Transaction } from "../models/Transaction";

// 🔹 BACKUP EXPORT TO GOOGLE DRIVE
export const exportBackup = async (req: Request, res: Response) => {
  try {
    const { googleToken } = req.body;
    if (!googleToken) return res.status(400).json({ msg: "Google Token is missing" });

    // Setup Google Drive Auth
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Fetch all database data
    const backupData = {
      users: await AppDataSource.getRepository(User).find({ relations: ["creator"] }),
      tokens: await AppDataSource.getRepository(Token).find({ relations: ["user"] }),
      materialAccounts: await AppDataSource.getRepository(MaterialAccount).find({ relations: ["user"] }),
      paymentHistory: await AppDataSource.getRepository(PaymentHistory).find({ relations: ["user", "admin"] }),
    };

    // Convert data to JSON stream
    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(JSON.stringify(backupData)));

    const fileMetadata = { name: "bricks_admin_backup.json", mimeType: "application/json" };
    const media = { mimeType: "application/json", body: bufferStream };

    // Upload to Google Drive
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

    // ⭐ Restore Data to Database (Clear existing and insert backup)
    await AppDataSource.transaction(async (transactionalEntityManager) => {
      // CLEAR TABLES (Reverse order due to foreign keys)
      await transactionalEntityManager.clear(PaymentHistory);
      await transactionalEntityManager.clear(Token);
      await transactionalEntityManager.clear(MaterialAccount);
      await transactionalEntityManager.clear(Transaction); // Assuming you have a Balance entity, if not, remove this line
      // Optional: Don't clear users if you want to keep admin accounts safe, 
      // but if you want 100% clone, you can clear and restore them too.
      // await transactionalEntityManager.clear(User); 

      // RESTORE DATA
      if (backupData.Transactions.length > 0) await transactionalEntityManager.save(Transaction, backupData.Transactions);
      if (backupData.users.length > 0) await transactionalEntityManager.save(User, backupData.users);
      if (backupData.materialAccounts.length > 0) await transactionalEntityManager.save(MaterialAccount, backupData.materialAccounts);
      if (backupData.tokens.length > 0) await transactionalEntityManager.save(Token, backupData.tokens);
      if (backupData.paymentHistory.length > 0) await transactionalEntityManager.save(PaymentHistory, backupData.paymentHistory);
    });

    return res.json({ msg: "✅ Database successfully restored from Google Drive!" });
  } catch (err) {
    console.error("Restore Error:", err);
    return res.status(500).json({ msg: "Server error during restore" });
  }
};