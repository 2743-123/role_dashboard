import { Router } from "express";
import { getPaymentHistory } from "../controllers/paymentHistoryController";
// Apna authMiddleware ka path check kar lijiye, agar alag folder me hai toh update karein
import { authMiddleWare} from "../middlewares/authMiddleware"; 

const router = Router();

// GET request on /api/payment-history
router.get("/", authMiddleWare, getPaymentHistory);

export default router;