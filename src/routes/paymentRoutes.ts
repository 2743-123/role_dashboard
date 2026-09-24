import { Router } from "express";
import { getPaymentHistory, getPaymentRecovery } from "../controllers/paymentHistoryController";
// Apna authMiddleware ka path check kar lijiye, agar alag folder me hai toh update karein
import { authMiddleWare} from "../middlewares/authMiddleware"; 

const router = Router();

// GET request on /api/payment-history
router.get("/", authMiddleWare, getPaymentHistory);
router.get("/recovery", authMiddleWare, getPaymentRecovery);

export default router;