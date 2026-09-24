import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { uploadToGoogleDrive } from "./driveService";
import dotenv from "dotenv";

dotenv.config();

export const performDatabaseBackup = () => {
  return new Promise((resolve, reject) => {
    try {
      console.log("⏳ Starting PostgreSQL Database Backup...");
      
      const dateStr = new Date().toISOString().replace(/:/g, "-").split(".")[0];
      const fileName = `BricksApp_Backup_${dateStr}.sql`;
      const dumpPath = path.join(__dirname, `../../backups/${fileName}`);

      // Backups folder check karna aur banana
      const backupDir = path.join(__dirname, "../../backups");
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir);
      }

      // Aapki .env file se Postgres ka URL nikalna
      const dbUrl = process.env.DATABASE_URL;

      if (!dbUrl) {
        console.error("❌ ERROR: DATABASE_URL is not defined in .env file.");
        return reject("No DATABASE_URL");
      }

      // PostgreSQL ka inbuilt backup command (pg_dump)
      const command = `pg_dump --dbname="${dbUrl}" --file="${dumpPath}"`;

      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error("❌ pg_dump execution failed (PostgreSQL tools required):", error.message);
          return reject(error);
        }

        console.log("✅ PostgreSQL Dump Created! Uploading to Google Drive...");

        // Google Drive pe upload karna
        await uploadToGoogleDrive(dumpPath, fileName);
        resolve(true);
      });

    } catch (error) {
      console.error("❌ Database Backup Failed:", error);
      reject(error);
    }
  });
};