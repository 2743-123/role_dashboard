import { AppDataSource } from "../../config/db";
import { Token } from "../../models/Token";
import { PaymentHistory } from "../../models/PaymentHistory";

const tokenRepo = AppDataSource.getRepository(Token);
const paymentRepo = AppDataSource.getRepository(PaymentHistory);
const RATE_PER_TON = 180;

export const paymentService = {
  checkPaymentHistory: async (targetUserName: string, currentUser: any) => {
    let query = paymentRepo.createQueryBuilder("p").leftJoinAndSelect("p.user", "user").leftJoinAndSelect("p.admin", "admin").orderBy("p.createdAt", "DESC").take(5);
    if (currentUser.role === "admin") query = query.where("admin.id = :id OR user.createdBy = :id", { id: currentUser.id });
    else if (currentUser.role === "user") query = query.where("user.id = :id", { id: currentUser.id });
    if (targetUserName) query = query.andWhere("user.name ILIKE :name", { name: `%${targetUserName}%` });
    
    const history = await query.getMany();
    if (!history.length) return { msg: `🤖 Koi payment history nahi mili.` };
    
    let replyMsg = `🤖 **Recent Payment History:**\n\n`;
    history.forEach((pay, idx) => { 
      let displayType = pay.type === "add_balance" ? "Stock Added" : pay.type;
      if (pay.type === "token_payment") {
        displayType = `Token Payment (${pay.details?.customerName || "Customer"})`;
      }
      replyMsg += `${idx + 1}. Date: ${new Date(pay.createdAt).toLocaleDateString("en-IN")} | User: ${pay.user?.name} | Type: **${displayType}** | Amount: ₹${pay.amount}\n`; 
    });
    return { msg: replyMsg };
  },

  customerPayment: async (params: any, currentUser: any) => {
    const customerName = params.customerName;
    let paymentAmt = Number(params.paymentAmount) || 0;
    const searchTruck = params.searchTruckNumber;
    const searchDate = params.searchDate;

    if (!customerName) return { msg: "🤖 Kripya customer ka naam batayein jiska payment aaya hai." };

    let tQuery = tokenRepo.createQueryBuilder("t").leftJoinAndSelect("t.user", "u").leftJoin("u.creator", "c")
      .where("t.customerName ILIKE :cName", { cName: `%${customerName}%` }).andWhere("t.status IN ('pending', 'updated')");

    if (currentUser.role === "admin") tQuery.andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId: currentUser.id });
    else if (currentUser.role === "user") tQuery.andWhere("u.id = :userId", { userId: currentUser.id });

    if (searchTruck) tQuery.andWhere("t.truckNumber ILIKE :sTruck", { sTruck: `%${searchTruck}%` });
    if (searchDate) tQuery.andWhere("CAST(t.updatedAt AS TEXT) ILIKE :sDate", { sDate: `${searchDate}%` });

    const unpaidTokens = await tQuery.orderBy("t.id", "ASC").getMany();
    if (unpaidTokens.length === 0) return { msg: `🤖 Customer *${customerName}* ki aisi koi baaki (due) token nahi mili jisme payment add kiya ja sake.` };

    let processedList: string[] = [];
    let firstModifiedTokenId: number | null = null;
    let targetUserForLedger = unpaidTokens[0].user;
    let rawPaymentDataToSave: any[] = [];

    if (paymentAmt === 0 && (searchTruck || searchDate)) {
      for (const t of unpaidTokens) {
        const bill = Number(t.totalAmount || 0); const due = bill - Number(t.paidAmount || 0);
        t.paidAmount = bill; t.status = "completed";
        if (!firstModifiedTokenId) firstModifiedTokenId = t.id;
        
        const dateStr = t.updatedAt ? new Date(t.updatedAt).toLocaleDateString("en-GB") : "N/A";
        processedList.push(`🚛 Truck **${t.truckNumber || "N/A"}** (${t.weight}T, ${dateStr}) 👉 **Full Paid**`);
        rawPaymentDataToSave.push({
          user: targetUserForLedger, admin: currentUser, amount: due, type: "token_payment",
          details: { customerName: t.customerName, dealerName: targetUserForLedger.name, tokenId: t.id, truckNumber: t.truckNumber || "-", materialType: t.materialType, weight: t.weight, ratePerTon: t.ratePerTon || RATE_PER_TON, commission: t.commission || 0, billAmount: bill, paidAmount: due, status: "completed" }
        });
      }
    } 
    else if (paymentAmt > 0) {
      let remainingPayment = paymentAmt;
      for (const t of unpaidTokens) {
        if (remainingPayment <= 0) break;
        const bill = Number(t.totalAmount || 0); const paid = Number(t.paidAmount || 0); const due = bill - paid;
        if (due <= 0 && t.status !== "pending") continue;
        if (!firstModifiedTokenId) firstModifiedTokenId = t.id;

        let applied = 0;
        if (due > 0) {
          if (remainingPayment >= due) { applied = due; t.paidAmount = bill; t.status = "completed"; remainingPayment -= due; } 
          else { applied = remainingPayment; t.paidAmount = paid + remainingPayment; t.status = "updated"; remainingPayment = 0; }
        } else if (t.status === "pending") { t.status = "completed"; }

        if (applied > 0 || t.status === "completed") {
          const dateStr = t.updatedAt ? new Date(t.updatedAt).toLocaleDateString("en-GB") : "N/A";
          processedList.push(`🚛 Truck **${t.truckNumber || "N/A"}** (${t.weight}T, ${dateStr}) 👉 **₹${applied} Applied** [${t.status.toUpperCase()}]`);
          rawPaymentDataToSave.push({
            user: targetUserForLedger, admin: currentUser, amount: applied, type: "token_payment",
            details: { customerName: t.customerName, dealerName: targetUserForLedger.name, tokenId: t.id, truckNumber: t.truckNumber || "-", materialType: t.materialType, weight: t.weight, ratePerTon: t.ratePerTon || RATE_PER_TON, commission: t.commission || 0, billAmount: bill, paidAmount: applied, status: t.status }
          });
        }
      }
      if (remainingPayment > 0) processedList.push(`\n💰 **₹${remainingPayment}** advance me jama ho gaye hain.`);
    } else {
      return { msg: "🤖 Kripya batayein kitna payment aaya hai, ya kis truck ka payment clear karna hai." };
    }

    await tokenRepo.save(unpaidTokens);
    if (rawPaymentDataToSave.length > 0) {
      for (const data of rawPaymentDataToSave) { const newRecord = paymentRepo.create(data); await paymentRepo.save(newRecord); }
    }

    if (firstModifiedTokenId) {
      const adminId = targetUserForLedger.role === "user" ? targetUserForLedger.creator?.id : targetUserForLedger.id;
      const prevTokenBeforeCurrent = await tokenRepo.createQueryBuilder("t").leftJoin("t.user", "u").leftJoin("u.creator", "c").where("t.customerName ILIKE :cName", { cName: `%${customerName}%` }).andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId }).andWhere("t.id < :id", { id: firstModifiedTokenId }).orderBy("t.id", "DESC").getOne();
      let runningCarry = prevTokenBeforeCurrent ? Number(prevTokenBeforeCurrent.carryForward || 0) : 0;
      const allRelevantTokens = await tokenRepo.createQueryBuilder("t").leftJoinAndSelect("t.user", "u").where("t.customerName ILIKE :cName", { cName: `%${customerName}%` }).andWhere("t.id >= :id", { id: firstModifiedTokenId }).orderBy("t.id", "ASC").getMany();
      const tokensToSave = [];
      for (const t of allRelevantTokens) {
        const tTotal = Number(t.totalAmount || 0); const tPaid = Number(t.paidAmount || 0);
        runningCarry = Number((runningCarry + tPaid - tTotal).toFixed(2));
        t.carryForward = runningCarry;
        if (tTotal > 0 && t.status === "pending") t.status = "updated";
        tokensToSave.push(t);
      }
      await tokenRepo.save(tokensToSave);
    }
    return { msg: `✅ **Payment Successfully Processed for Customer: ${customerName.toUpperCase()}**\n\n` + processedList.join("\n") };
  }
};