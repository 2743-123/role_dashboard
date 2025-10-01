import { Router } from "express";
import {
  deleteUser,
  getUser,
  login,
  register,
  updateuser,
} from "../controllers/authControllers";
import {
  adminMiddleware,
  authMiddleWare,
  roleCheckMiddleware,
  roleCheckUpdateDelete,
  superAdminMiddleware,
} from "../middlewares/authMiddleware";

const router = Router();

router.post("/register", authMiddleWare, roleCheckMiddleware, register);
router.post("/login", login);
router.get(
  "/users",
  authMiddleWare,
  superAdminMiddleware,
  adminMiddleware,
  getUser
);
router.put("/update/:id", authMiddleWare, roleCheckUpdateDelete, updateuser);
router.delete("/delete/:id", authMiddleWare, roleCheckUpdateDelete, deleteUser);

export default router;
