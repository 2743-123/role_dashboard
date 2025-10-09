import { Router } from "express";
import { login, logout, register } from "../controllers/authControllers";
import {
  authMiddleWare,
  roleCheckMiddleware,
} from "../middlewares/authMiddleware";

const router = Router();

router.post("/register", authMiddleWare, roleCheckMiddleware, register);
router.post("/login", login);
router.post("/logout", authMiddleWare, logout);

export default router;
