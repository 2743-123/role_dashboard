import { Router } from "express";
import { handleAiCommand } from "../controllers/aiCommandController";
import { authMiddleWare } from "../middlewares/authMiddleware";


const router = Router();

router.post("/command", authMiddleWare, handleAiCommand);

export default router;