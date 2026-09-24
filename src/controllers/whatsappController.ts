import { Request, Response } from "express";
import { generateWhatsAppSession, sessionStatus, qrCodeData } from "../services/whatsappService";

export const getAdminQr = async (req: Request, res: Response) => {
  const { adminId } = req.params; 

  return new Promise((resolve) => {
    generateWhatsAppSession(adminId, (qrCodeString) => {
      res.status(200).json({ qr: qrCodeString, status: "QR_READY" });
      resolve(null);
    });
  });
};

export const checkWhatsappStatus = (req: Request, res: Response) => {
  const { adminId } = req.params;
  const status = sessionStatus.get(adminId) || "DISCONNECTED";
  
  // ⭐ FIX: Yahan frontend ko QR return kiya ja raha hai taaki API me dikhe
  const qr = qrCodeData.get(adminId) || null; 
  
  res.status(200).json({ status, qr });
};