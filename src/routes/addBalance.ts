import express from "express";

import { authMiddleWare } from "../middlewares/authMiddleware";
import { addBalance, getBalance } from "../controllers/AddBalance";

const router = express.Router();

router.post("/add", authMiddleWare, addBalance);
router.get("/getBalance/:userId", authMiddleWare, getBalance);

export default router;
