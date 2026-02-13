import express from "express";
import { authMiddleWare } from "../middlewares/authMiddleware";
import {
  confirmToken,
  createToken,
  deleteToken,
  getAdminAllUserTokens,
  getAllTokens,
  updateToken,
} from "../controllers/crateToken";

const router = express.Router();

router.post("/create", authMiddleWare, createToken);
router.put("/update", authMiddleWare, updateToken);
router.put("/confirm", authMiddleWare, confirmToken);
router.get("/all/:userId", authMiddleWare, getAllTokens);
router.get("/all", authMiddleWare, getAdminAllUserTokens);
router.delete("/:tokenId", authMiddleWare, deleteToken);

export default router;
