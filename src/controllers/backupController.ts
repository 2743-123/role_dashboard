
import { Request, Response } from "express";
import { google } from "googleapis";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { Token } from "../models/Token";
import { MaterialAccount } from "../models/materialaccount";
import { PaymentHistory } from "../models/PaymentHistory";
import { Transaction } from "../models/Transaction";
import { BedashMessage } from "../models/bedashMessage";
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

    // Fetch all database data including all entities and relations
    const backupData = {
      users: await AppDataSource.getRepository(User).find({ relations: ["creator"] }),
      tokens: await AppDataSource.getRepository(Token).find({ relations: ["user"] }),
      materialAccounts: await AppDataSource.getRepository(MaterialAccount).find({ relations: ["user"] }),
      paymentHistory: await AppDataSource.getRepository(PaymentHistory).find({ relations: ["user", "admin"] }),
      transactions: await AppDataSource.getRepository(Transaction).find({ relations: ["user"] }),
      bedashMessages: await AppDataSource.getRepository(BedashMessage).find({ relations: ["user", "createdBy"] }),
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

    return res.json({ msg: "✅ Full backup successfully saved to Google Drive" });
  } catch (err) {
    console.error("Backup Error:", err);
    return res.status(500).json({ msg: "Server error during backup" });
  }
};

// 🔹 RESTORE IMPORT FROM GOOGLE DRIVE
// 🔹 RESTORE IMPORT FROM GOOGLE DRIVE
// 🔹 RESTORE IMPORT FROM GOOGLE DRIVE (PERFECT CREATED_BY FIX)
export const importBackup = async (req: Request, res: Response) => {
  try {
    const { googleToken } = req.body;
    if (!googleToken) return res.status(400).json({ msg: "Google Token is missing" });

    // Setup Google Drive Auth
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: googleToken });
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Find latest backup file
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
    const file = await drive.files.get({ fileId: fileId, alt: "media" }, { responseType: "json" });
    const backupData: any = file.data;

    if (!backupData || !backupData.users) {
      return res.status(400).json({ msg: "Invalid backup file format" });
    }

    await AppDataSource.transaction(async (manager) => {
      // 1. CLEAR ALL TABLES
      await manager.query(`TRUNCATE TABLE "payment_history" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "bedash_message" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "material_account" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "token" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "transaction" RESTART IDENTITY CASCADE;`);
      await manager.query(`TRUNCATE TABLE "user" RESTART IDENTITY CASCADE;`);

      // 2. RESTORE USERS - STEP A: Insert basic data preserving exact original IDs
      for (const u of backupData.users) {
        await manager.query(
          `INSERT INTO "user" ("id", "name", "email", "password", "role", "isActive", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT ("id") DO NOTHING;`,
          [u.id, u.name, u.email, u.password, u.role, u.isActive, u.createdAt || new Date()]
        );
      }

      // 3. RESTORE USERS - STEP B: Update 'createdBy' exactly as saved in backup
      for (const u of backupData.users) {
        const creatorId = u.creator?.id || u.createdBy || null;
        if (creatorId) {
          await manager.query(
            `UPDATE "user" SET "createdBy" = $1 WHERE "id" = $2;`,
            [creatorId, u.id]
          );
        }
      }

      // Sync Postgres ID Sequence so new user creation won't clash
      await manager.query(`SELECT setval(pg_get_serial_sequence('"user"', 'id'), coalesce(max(id), 1)) FROM "user";`);

      // 4. RESTORE OTHER TABLES SAFELY
      if (backupData.transactions?.length > 0) {
        await manager.getRepository(Transaction).save(backupData.transactions, { reload: false });
        await manager.query(`SELECT setval(pg_get_serial_sequence('"transaction"', 'id'), coalesce(max(id), 1)) FROM "transaction";`);
      }

      if (backupData.materialAccounts?.length > 0) {
        await manager.getRepository(MaterialAccount).save(backupData.materialAccounts, { reload: false });
        await manager.query(`SELECT setval(pg_get_serial_sequence('"material_account"', 'id'), coalesce(max(id), 1)) FROM "material_account";`);
      }

      if (backupData.tokens?.length > 0) {
        await manager.getRepository(Token).save(backupData.tokens, { reload: false });
        await manager.query(`SELECT setval(pg_get_serial_sequence('"token"', 'id'), coalesce(max(id), 1)) FROM "token";`);
      }

      if (backupData.bedashMessages?.length > 0) {
        await manager.getRepository(BedashMessage).save(backupData.bedashMessages, { reload: false });
        await manager.query(`SELECT setval(pg_get_serial_sequence('"bedash_message"', 'id'), coalesce(max(id), 1)) FROM "bedash_message";`);
      }

      if (backupData.paymentHistory?.length > 0) {
        await manager.getRepository(PaymentHistory).save(backupData.paymentHistory, { reload: false });
        await manager.query(`SELECT setval(pg_get_serial_sequence('"payment_history"', 'id'), coalesce(max(id), 1)) FROM "payment_history";`);
      }
    });

    return res.json({ msg: "✅ Database successfully restored with exact Original Created-By data!" });
  } catch (err: any) {
    console.error("Restore Error Details:", err.message || err);
    return res.status(500).json({ msg: "Server error during restore", error: err.message });
  }
};