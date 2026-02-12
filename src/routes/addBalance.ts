import express from "express";

import { authMiddleWare } from "../middlewares/authMiddleware";
import { addBalance, getAllUsersBalanceReport, getBalance } from "../controllers/AddBalance";

const router = express.Router();

router.post("/add", authMiddleWare, addBalance);
router.get("/getBalance/:userId", authMiddleWare, getBalance);
router.get("/getAllUserBalance", authMiddleWare, getAllUsersBalanceReport);

export default router;