import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { PaymentHistory } from "../models/PaymentHistory";
import { Token } from "../models/Token";

const historyRepo = AppDataSource.getRepository(PaymentHistory);

export const getPaymentHistory = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    let history = [];

    if (currentUser.role === "superadmin") {
      history = await historyRepo.find({
        relations: ["user", "admin"],
        order: { createdAt: "DESC" }
      });
    } else if (currentUser.role === "admin") {
      history = await historyRepo.find({
        where: [
          { admin: { id: currentUser.id } }, // Payment added by this admin
          { user: { creator: { id: currentUser.id } } } // Payment related to users of this admin
        ],
        relations: ["user", "admin"],
        order: { createdAt: "DESC" }
      });
    } else {
      history = await historyRepo.find({
        where: { user: { id: currentUser.id } },
        relations: ["user", "admin"],
        order: { createdAt: "DESC" }
      });
    }

    // Response Format Clean kar rahe hain taaki Frontend par aasaani se dikhe
    const formattedHistory = history.map(h => ({
      id: h.id,
      date: h.createdAt,
      type: h.type,
      amount: Number(h.amount),
      userName: h.user?.name || "Unknown",
      adminName: h.admin?.name || "System",
      details: h.details
    }));

    res.json({ msg: "✅ Payment history fetched", data: formattedHistory });
  } catch (err) {
    console.error("Payment history error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

// Naya function: getPaymentRecovery
export const getPaymentRecovery = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    
    let query = AppDataSource.getRepository(Token)
      .createQueryBuilder("t")
      .leftJoinAndSelect("t.user", "u")
      .leftJoinAndSelect("u.creator", "c")
      .where("(t.totalAmount > t.paidAmount OR t.totalCarting > t.cartingPaidAmount OR t.totalTokenOwnerAmount > t.tokenOwnerPaidAmount)")
      .andWhere("t.status IN (:...statuses)", { statuses: ["pending", "updated"] });

    if (currentUser.role === "admin") {
       query = query.andWhere("(c.id = :adminId OR u.id = :adminId)", { adminId: currentUser.id });
    } else if (currentUser.role === "user") {
       query = query.andWhere("u.id = :userId", { userId: currentUser.id });
    }
    
    const pendingTokens = await query.orderBy("t.id", "ASC").getMany();

    // 🟢 3 Alag-alag ledgers (Maps) banayenge
    const customerMap: any = {};
    const cartingMap: any = {};
    const tokenOwnerMap: any = {};

    // Helper Function: Group karne ke liye
    // Helper Function: Group karne ke liye
    // Helper Function: Group karne ke liye
    const addDue = (
      map: any, 
      name: string | null | undefined, 
      phone: string | null | undefined, 
      dealer: string, 
      type: string, 
      token: any, 
      dueAmount: number
    ) => {
      if (!name) return; // Agar naam nahi hai toh skip
      
      if (!map[name]) {
        map[name] = {
          entityName: name,
          entityPhone: phone || "N/A",
          entityType: type,
          dealerName: dealer,
          totalOverallDue: 0,
          tokens: []
        };
      }

      map[name].totalOverallDue += dueAmount;

      // ⭐ Yahan par sari extra details push ki gayi hain
      map[name].tokens.push({
        tokenId: token.id,
        date: token.createdAt,
        materialType: token.materialType,
        truckNumber: token.truckNumber || "N/A",
        dueAmount: dueAmount, 
        status: token.status,
        
        userName: token.user?.name || "Unknown",
        weight: token.weight,
        ratePerTon: token.ratePerTon,
        sellRate: token.sellRate,
        cartingRate: token.cartingRate,
        tokenOwnerRate: token.tokenOwnerRate,
        commission: token.commission
      });
    };

    pendingTokens.forEach(t => {
      const dealerName = t.user?.name || "Unknown";
      
      // 1. Check Customer Dues
      const custDue = Math.max(0, Number(t.totalAmount || 0) - Number(t.paidAmount || 0));
      if (custDue > 0) addDue(customerMap, t.customerName, t.customerPhone, dealerName, "Customer", t, custDue);

      // 2. Check Carting Owner Dues
      const cartingDue = Math.max(0, Number(t.totalCarting || 0) - Number(t.cartingPaidAmount || 0));
      if (cartingDue > 0) addDue(cartingMap, t.cartingOwnerName, t.cartingOwnerPhone, dealerName, "Carting", t, cartingDue);

      // 3. Check 3rd Party Token Owner Dues
      const ownerDue = Math.max(0, Number(t.totalTokenOwnerAmount || 0) - Number(t.tokenOwnerPaidAmount || 0));
      if (ownerDue > 0) addDue(tokenOwnerMap, t.anotherTokenOwnerName, t.anotherTokenOwnerPhone, dealerName, "Token Owner", t, ownerDue);
    });

    // Teeno lists ko ek Array me combine karke Total Due ke hisaab se Sort kar do
    const resultArray = [
      ...Object.values(customerMap),
      ...Object.values(cartingMap),
      ...Object.values(tokenOwnerMap)
    ].sort((a: any, b: any) => b.totalOverallDue - a.totalOverallDue); 

    res.json({ msg: "✅ Recovery list fetched", data: resultArray });

  } catch (err) {
    console.error("Payment recovery error:", err);
    res.status(500).json({ msg: "Server error while fetching recovery list" });
  }
};