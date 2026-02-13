import express from "express";

import { authMiddleWare } from "../middlewares/authMiddleware";
import {
  addBalance,
  getAllUsersBalanceReport,
  getBalance,
  editBalance,      // ⭐ new
  deleteBalance,    // ⭐ new
} from "../controllers/AddBalance";

const router = express.Router();

/** ➕ Add balance */
router.post("/add", authMiddleWare, addBalance);

/** 📊 Get single user balance */
router.get("/getBalance/:userId", authMiddleWare, getBalance);

/** 📊 Admin all users balance report */
router.get("/getAllUserBalance", authMiddleWare, getAllUsersBalanceReport);

/** ✏️ Edit balance transaction */
router.put("/edit/:transactionId", authMiddleWare, editBalance);

/** 🗑️ Delete balance transaction */
router.delete("/delete/:transactionId", authMiddleWare, deleteBalance);

export default router;
