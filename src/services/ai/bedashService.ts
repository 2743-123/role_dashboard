import { AppDataSource } from "../../config/db";
import { BedashMessage } from "../../models/bedashMessage";
import { checkPermission, findUser } from "../../utils/aiHelpers";

const bedashRepo = AppDataSource.getRepository(BedashMessage);

export const bedashService = {
  bedashMessage: async (params: any, targetUserName: string, currentUser: any) => {
    const user = await findUser(targetUserName);
    if (!user) return { msg: "🤖 Kiske liye request banani/confirm karni hai? Naam batayein." };
    if (!checkPermission(currentUser, user)) return { msg: "🚫 Permission Denied." };
    const action = params.action?.toLowerCase(); 
    if (action === "add") {
      let targetDate = new Date();
      if (params.date) targetDate = new Date(params.date);
      else targetDate.setDate(targetDate.getDate() - 1);
      const newBedash = bedashRepo.create({ user, createdBy: { id: currentUser.id } as any, materialType: params.materialType || "bedash", amount: Number(params.amount) || 0, reminderPhone: params.reminderPhone || null, status: "pending", customDate: targetDate, targetDate: targetDate }); 
      await bedashRepo.save(newBedash); 
      return { msg: `✅ **${user.name}** ke liye Bedash request add ho gayi hai (Date: ${targetDate.toLocaleDateString("en-GB")}).` };
    } else if (action === "confirm") {
      const pending = await bedashRepo.findOne({ where: { user: { id: user.id }, status: "pending" }, order: { id: "DESC" } });
      if (!pending) return { msg: `🤖 **${user.name}** ki koi pending request nahi mili.` };
      pending.status = "completed"; await bedashRepo.save(pending); 
      return { msg: `✅ **${user.name}** ki pending Bedash request COMPLETED mark ho gayi hai.` };
    } 
    return { msg: "🤖 Action samajh nahi aaya. 'add' ya 'confirm' specify karein." };
  },

  reportBedashMessages: async (params: any, currentUser: any) => {
    let bQuery = bedashRepo.createQueryBuilder("b").leftJoinAndSelect("b.user", "u").leftJoin("u.creator", "c");
    if (currentUser.role === "admin") bQuery.andWhere("c.id = :adminId", { adminId: currentUser.id });
    else if (currentUser.role === "user") bQuery.andWhere("u.id = :userId", { userId: currentUser.id });

    const sortOrder = params.sortOrder === "ASC" ? "ASC" : "DESC";
    let q = bQuery.orderBy("b.targetDate", sortOrder).addOrderBy("b.id", sortOrder);
    if (params.limit > 0) q = q.take(params.limit);
    const messages = await q.getMany();
    
    if (messages.length === 0) return { msg: "🤖 Koi Bedash message nahi mila." };
    const orderText = sortOrder === "ASC" ? "Pahle (Upcoming)" : "Aakhri (Past)";
    let msg = params.limit > 0 ? `🤖 **${orderText} ${messages.length} Bedash Messages:**\n\n` : `🤖 **Saare Bedash Messages (${orderText}):**\n\n`;
    messages.forEach(m => {
      const dateStr = m.targetDate ? new Date(m.targetDate).toLocaleDateString("en-GB") : (m.customDate ? new Date(m.customDate).toLocaleDateString("en-GB") : new Date(m.createdAt).toLocaleDateString("en-GB"));
      msg += `• **${m.user?.name}** - ${m.amount} Tons (Target Date: ${dateStr}) - [${m.status.toUpperCase()}]\n`;
    });
    return { msg };
  }
};