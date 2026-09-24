import { Router } from "express";
import { getAdminQr, checkWhatsappStatus } from "../controllers/whatsappController";
import { authMiddleWare } from "../middlewares/authMiddleware";

const router = Router();

// Route me specific adminId bhejenge
router.post("/generate-qr/:adminId", authMiddleWare, getAdminQr);
router.get("/status/:adminId", authMiddleWare, checkWhatsappStatus);

export default router;