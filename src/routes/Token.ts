import express from "express";
import { authMiddleWare } from "../middlewares/authMiddleware";
import { confirmToken, createToken, getAllTokens, updateToken } from "../controllers/crateToken";


const router = express.Router();

router.post("/create", authMiddleWare, createToken);
router.put("/update", authMiddleWare, updateToken);
router.put("/confirm", authMiddleWare, confirmToken);
router.get("/all/:userId", authMiddleWare, getAllTokens);

export default router;