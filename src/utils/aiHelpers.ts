import { AppDataSource } from "../config/db";
import { User } from "../models/User";

const userRepo = AppDataSource.getRepository(User);

export const checkPermission = (currentUser: any, targetUser: any) => {
  if (currentUser.role === "superadmin") return true;
  if (currentUser.role === "admin" && targetUser.creator?.id === currentUser.id) return true;
  if (currentUser.role === "user" && targetUser.id === currentUser.id) return true;
  return false;
};

export const findUser = async (name: string) => {
  if (!name) return null;
  return await userRepo.createQueryBuilder("user")
    .leftJoinAndSelect("user.creator", "creator")
    .where("user.name ILIKE :name", { name: `%${name}%` })
    .getOne();
};