import { google } from "googleapis";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// ⭐ FIX: ':' ki jagah '=' aayega. Aur TS ko batane ke liye string set kiya hai.
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || ""; 

// OAuth2 Client Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GDRIVE_CLIENT_ID,
  process.env.GDRIVE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

// Refresh token set karna (Ye kabhi expire nahi hoga)
oauth2Client.setCredentials({
  refresh_token: process.env.GDRIVE_REFRESH_TOKEN,
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

export const uploadToGoogleDrive = async (filePath: string, fileName: string) => {
  try {
    if (!GOOGLE_DRIVE_FOLDER_ID) {
      throw new Error("GOOGLE_DRIVE_FOLDER_ID is not defined in .env file");
    }

    console.log(`⏳ Uploading ${fileName} to Google Drive using OAuth2...`);
    
    const fileMetadata = {
      name: fileName,
      parents: [GOOGLE_DRIVE_FOLDER_ID],
    };
    
    const media = {
      mimeType: "application/sql", // Agar ZIP hai toh "application/zip" kar dena
      body: fs.createReadStream(filePath),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id",
    });

    console.log(`✅ Backup uploaded successfully! File ID: ${file.data.id}`);
    
    // ⭐ SAFETY CHECK: Upload ke baad local file delete karne se pehle check karein
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Local backup file deleted to save storage.`);
    }

    return file.data.id;
  } catch (error: any) {
    console.error("❌ Google Drive Upload Error:", error?.message || error);
    
    // ⭐ Error ko yahan throw karna zaroori hai, taaki jis function ne isko call kiya hai 
    // (jaise backupController), usko pata chale ki upload fail ho gaya hai.
    throw new Error("Failed to upload backup to Google Drive.");
  }
};