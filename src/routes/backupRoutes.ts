import express from "express";
import { authMiddleWare } from "../middlewares/authMiddleware"; 
import { exportBackup, importBackup } from "../controllers/backupController";

const router = express.Router();

// Backup & Restore routes
router.post("/export", authMiddleWare, exportBackup);
router.post("/import", authMiddleWare, importBackup);

export default router;