import express from "express";
import { authMiddleWare } from "../middlewares/authMiddleware"; 
import { exportBackup, importBackup } from "../controllers/backupController";
import { triggerAdminBackup } from "../controllers/backup_Controller";

const router = express.Router();

// Backup & Restore routes
router.post("/export", authMiddleWare, exportBackup);
router.post("/import", authMiddleWare, importBackup);
router.post("/trigger-my-backup", authMiddleWare, triggerAdminBackup);

export default router;