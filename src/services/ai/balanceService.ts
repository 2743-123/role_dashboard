import { AppDataSource } from "../../config/db";
import { MaterialAccount } from "../../models/materialaccount";
import { Transaction } from "../../models/Transaction";
import { PaymentHistory } from "../../models/PaymentHistory";
import { checkPermission, findUser } from "../../utils/aiHelpers";

const accountRepo = AppDataSource.getRepository(MaterialAccount);
const transactionRepo = AppDataSource.getRepository(Transaction);
const paymentRepo = AppDataSource.getRepository(PaymentHistory);
const RATE_PER_TON = 180;

export const balanceService = {
  addBalance: async (params: any, targetUserName: string, currentUser: any) => {
    if (currentUser.role === "user") return { msg: "🚫 Aap khud apna balance add nahi kar sakte. Kripya Admin se sampark karein." };
    const user = await findUser(targetUserName);
    if (!user) return { msg: "🤖 Balance add karne ke liye valid user naam batayein." };
    if (!checkPermission(currentUser, user)) return { msg: "🚫 Permission Denied." };
    const fAmt = Number(params.flyashAmount) || 0; const bAmt = Number(params.bedashAmount) || 0; const totalMoney = fAmt + bAmt;
    const fTons = fAmt / RATE_PER_TON; const bTons = bAmt / RATE_PER_TON;
    
    let fAcc = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "flyash" } });
    if (!fAcc) fAcc = accountRepo.create({ user, materialType: "flyash", totalTons: 0, usedTons: 0, remainingTons: 0 });
    fAcc.totalTons += fTons; fAcc.remainingTons += fTons;
    
    let bAcc = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "bedash" } });
    if (!bAcc) bAcc = accountRepo.create({ user, materialType: "bedash", totalTons: 0, usedTons: 0, remainingTons: 0 });
    bAcc.totalTons += bTons; bAcc.remainingTons += bTons;
    
    await accountRepo.save([fAcc, bAcc]);
    const transaction = transactionRepo.create({ user, totalAmount: totalMoney, flyashAmount: fAmt, bedashAmount: bAmt, flyashTons: fTons, bedashTons: bTons, paymentMode: params.paymentMode || "cash" });
    await transactionRepo.save(transaction);
    const payment = paymentRepo.create({ user: user, admin: { id: currentUser.id } as any, amount: totalMoney, type: "add_balance", details: { flyashAmount: fAmt, bedashAmount: bAmt, flyashTons: fTons, bedashTons: bTons, paymentMode: params.paymentMode || "cash" } } as any); 
    await paymentRepo.save(payment);
    return { msg: `✅ ${user.name} ke account me Flyash: ₹${fAmt} aur Bedash: ₹${bAmt} add ho gaye hain.` };
  },

  getBalance: async (targetUserName: string) => {
    const user = await findUser(targetUserName);
    if (!user) return { msg: "🤖 Kiska balance check karna hai? Naam batayein." };
    const flyash = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "flyash" } });
    const bedash = await accountRepo.findOne({ where: { user: { id: user.id }, materialType: "bedash" } });
    return { msg: `🤖 **${user.name} ka Stock:**\n📦 Flyash: ${flyash?.remainingTons || 0} Tons\n📦 Bedash: ${bedash?.remainingTons || 0} Tons.` };
  },

  reportBalance: async (params: any, currentUser: any) => {
    const filter = params.filterType;
    const limit = params.limit || 5;
    
    if (filter === "latest" || filter === "monthly") {
      let pQuery = paymentRepo.createQueryBuilder("p").leftJoinAndSelect("p.user", "u").leftJoin("u.creator", "c").where("p.type = 'add_balance'");
      if (currentUser.role === "admin") pQuery.andWhere("c.id = :adminId", { adminId: currentUser.id });
      else if (currentUser.role === "user") pQuery.andWhere("u.id = :userId", { userId: currentUser.id });

      if (filter === "monthly") {
        const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        pQuery.andWhere("p.createdAt >= :start", { start: firstDay });
      } else {
        pQuery.orderBy("p.createdAt", "DESC").take(limit);
      }
      const history = await pQuery.getMany();
      if (history.length === 0) return { msg: "🤖 Koi balance history nahi mili." };
      let msg = filter === "monthly" ? `🤖 **Is Mahine Ki Balance Entry:**\n\n` : `🤖 **Aakhri ${history.length} Balance Entry:**\n\n`;
      history.forEach(h => { msg += `• **${h.user?.name}** - ₹${h.amount} (${new Date(h.createdAt).toLocaleDateString('en-GB')})\n`; });
      return { msg };
    }
    
    if (filter === "highest_stock" || filter === "low_balance") {
      let aQuery = accountRepo.createQueryBuilder("a").leftJoinAndSelect("a.user", "u").leftJoin("u.creator", "c");
      if (currentUser.role === "admin") aQuery.andWhere("c.id = :adminId", { adminId: currentUser.id });
      else if (currentUser.role === "user") aQuery.andWhere("u.id = :userId", { userId: currentUser.id });

      if (filter === "low_balance") aQuery.andWhere("a.remainingTons < 10").orderBy("a.remainingTons", "ASC").take(10);
      else aQuery.orderBy("a.remainingTons", "DESC").take(limit);
      
      const accounts = await aQuery.getMany();
      if (accounts.length === 0) return { msg: "🤖 Koi data nahi mila." };
      let msg = filter === "low_balance" ? `🤖 **Low Balance Users (10 Tons se kam):**\n\n` : `🤖 **Highest Stock Users:**\n\n`;
      accounts.forEach(a => { msg += `• **${a.user?.name}** (${a.materialType}): ${Number(a.remainingTons).toFixed(2)} Tons\n`; });
      return { msg };
    }
    return { msg: "🤖 Invalid filter type." };
  }
};