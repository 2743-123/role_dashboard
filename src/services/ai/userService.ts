import { AppDataSource } from "../../config/db";
import bcrypt from "bcryptjs";
import { User } from "../../models/User";
import { MaterialAccount } from "../../models/materialaccount";
import { Transaction } from "../../models/Transaction";
import { BedashMessage } from "../../models/bedashMessage";
import { checkPermission, findUser } from "../../utils/aiHelpers";

const userRepo = AppDataSource.getRepository(User);

export const userService = {
  createUser: async (params: any, currentUser: any) => {
    if (currentUser.role === "user") return { msg: "🚫 Aap naye user nahi bana sakte." };
    if (!params.name) return { msg: "🤖 User ka naam batana zaroori hai." };
    const hashedPassword = await bcrypt.hash("password123", 10);
    const newUser = userRepo.create({ name: params.name, role: params.role || "user", phone: params.phone || "", email: `${params.name.replace(/\s+/g, "").toLowerCase()}@bricks.com`, password: hashedPassword, isActive: true, creator: currentUser });
    await userRepo.save(newUser);
    return { msg: `✅ User '${params.name}' system me add ho gaya hai.` };
  },

  deleteUser: async (targetUserName: string, currentUser: any) => {
    if (currentUser.role === "user") return { msg: "🚫 Aap kisi user ko delete nahi kar sakte." };
    const user = await findUser(targetUserName);
    if (!user) return { msg: `🤖 '${targetUserName}' naam ka user nahi mila.` };
    if (!checkPermission(currentUser, user)) return { msg: "🚫 Aap is user ko delete nahi kar sakte." };
    await AppDataSource.manager.transaction(async (manager) => {
      await manager.delete(MaterialAccount, { user: { id: user.id } });
      await manager.delete(Transaction, { user: { id: user.id } });
      await manager.delete(BedashMessage, { user: { id: user.id } });
      await manager.remove(user);
    });
    return { msg: `🗑️ User '${user.name}' aur uska saara data delete ho gaya hai.` };
  },

  reportUsers: async (currentUser: any) => {
    if (currentUser.role === "user") return { msg: "🚫 Aapko system ke users dekhne ki permission nahi hai." };
    let uQuery = userRepo.createQueryBuilder("u").where("u.role = 'user'");
    if (currentUser.role === "admin") { uQuery = uQuery.leftJoin("u.creator", "c").andWhere("c.id = :adminId", { adminId: currentUser.id }); }
    const users = await uQuery.orderBy("u.name", "ASC").getMany();
    if (users.length === 0) return { msg: "🤖 Aapke under abhi koi user nahi hai." };
    const names = users.map((u, i) => `${i + 1}. ${u.name}`).join("\n");
    return { msg: `🤖 Hello **${currentUser.name}**, Aapke Users Ki List:\n\n${names}` };
  }
};