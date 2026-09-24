import fs from "fs";
import path from "path";
import { AppDataSource } from "../config/db";
import { Token } from "../models/Token";
import { Transaction } from "../models/Transaction";
import { MaterialAccount } from "../models/materialaccount";
import { BedashMessage } from "../models/bedashMessage";
import { uploadToGoogleDrive } from "./driveService";

export const performAdminBackup = async (adminId: string | number, adminEmail: string) => {
  try {
    const numericAdminId = Number(adminId);
    console.log(`⏳ Fetching scoped data for Admin: ${adminEmail} (ID: ${numericAdminId})...`);

    const tokenRepo = AppDataSource.getRepository(Token);
    const transactionRepo = AppDataSource.getRepository(Transaction);
    const materialRepo = AppDataSource.getRepository(MaterialAccount);
    const messageRepo = AppDataSource.getRepository(BedashMessage);

    // Relation query: user: { id: numericAdminId }
    const [tokens, transactions, materials, messages] = await Promise.all([
      tokenRepo.find({
        where: { user: { id: numericAdminId } },
        order: { createdAt: "DESC" },
      }),
      transactionRepo.find({
        where: { user: { id: numericAdminId } },
        order: { createdAt: "DESC" },
      }),
      materialRepo.find({
        where: { user: { id: numericAdminId } },
      }),
      // Agar BedashMessage me user relation ho toh filter lagayen, warna fallback
      messageRepo.find({
        where: { user: { id: numericAdminId } } as any,
      }).catch(() => []),
    ]);

    // JSON Payload
    const backupPayload = {
      adminId: numericAdminId,
      adminEmail,
      backupCreatedAt: new Date().toISOString(),
      summary: {
        totalTokens: tokens.length,
        totalTransactions: transactions.length,
        totalMaterials: materials.length,
        totalMessages: messages.length,
      },
      data: {
        tokens,
        transactions,
        materials,
        messages,
      },
    };

    // Backup Directory & File Generation
    const dateStr = new Date().toISOString().replace(/:/g, "-").split(".")[0];
    const cleanEmail = (adminEmail || "admin").replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `Backup_${cleanEmail}_${dateStr}.json`;
    
    const backupDir = path.join(__dirname, "../../backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const filePath = path.join(backupDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(backupPayload, null, 2), "utf-8");

    console.log(`✅ File generated: ${fileName}. Uploading to Drive...`);

    // Google Drive Upload
    await uploadToGoogleDrive(filePath, fileName);

    return { success: true, fileName, summary: backupPayload.summary };
  } catch (error) {
    console.error(`❌ Backup failed for Admin ${adminId}:`, error);
    throw error;
  }
};