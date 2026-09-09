import { Router } from "express";
import { handleWhatsAppWebhook } from "../controllers/webhookController";

const router = Router();

// UltraMsg is URL par POST request bhejega
router.post("/whatsapp/webhook", handleWhatsAppWebhook);

export default router;