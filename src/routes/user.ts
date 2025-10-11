import { Router } from "express";
import {
  adminMiddleware,
  authMiddleWare,
  roleCheckUpdateDelete,

} from "../middlewares/authMiddleware";
import { deleteUser, getUser, updateuser } from "../controllers/userController";

const router = Router();

router.get(
  "/users",
  authMiddleWare,
  adminMiddleware,
  getUser
);
router.put("/update/:id", authMiddleWare, roleCheckUpdateDelete, updateuser);
router.delete("/delete/:id", authMiddleWare, roleCheckUpdateDelete, deleteUser);

export default router;
