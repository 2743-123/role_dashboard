import { Request, Response } from "express";
import { performAdminBackup } from "../services/adminBackupService";

export const triggerAdminBackup = async (req: Request, res: Response) => {
  try {
    // JWT auth middleware se authenticated admin details
    const admin = (req as any).user; 

    if (!admin || !admin.id) {
      return res.status(401).json({ message: "Unauthorized: Admin session missing" });
    }

    const result = await performAdminBackup(admin.id, admin.email);

    return res.status(200).json({
      message: "✅ Aapka personal backup successfully create hokar Google Drive par save ho gaya.",
      details: result,
    });
  } catch (error: any) {
    return res.status(500).json({ message: "Backup generation failed", error: error.message });
  }
};