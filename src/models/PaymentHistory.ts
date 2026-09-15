import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  ManyToOne, 
  Index 
} from "typeorm";
import { User } from "./User";

@Entity()
export class PaymentHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  user!: User; // Kiska account/token hai

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  admin!: User; // Kis admin ne payment add/confirm kiya

  // ⚡ Index for fast filtering (eg: sirf "token_payment" wali history dekhna)
  // 🛠️ "varchar" ko pehla argument banaya TypeORM error se bachne ke liye
  @Index()
  @Column("varchar", { length: 50 })
  type!: "add_balance" | "token_payment";

  // 🛠️ "numeric" as first argument
  @Column("numeric", { precision: 12, scale: 2 })
  amount!: number; // Total amount jo pay/add hua is baar

  // 🛠️ "json" as first argument (truck details, weight wagarah ke liye)
  @Column("json", { nullable: true })
  details!: any; 

  // ⚡ Index lagaya taaki date ke hisaab se sorting (Latest payments) ekdam fast ho
  @Index()
  @CreateDateColumn()
  createdAt!: Date;
}