import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from "typeorm";
import { User } from "./User";

@Entity()
export class PaymentHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  user!: User; // Kiska account/token hai

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  admin!: User; // Kis admin ne payment add/confirm kiya

  @Column({ type: "varchar", length: 50 })
  type!: "add_balance" | "token_payment";

  @Column({ type: "numeric", precision: 12, scale: 2 })
  amount!: number; // Total amount jo pay/add hua is baar

  // JSON format me truck numbers, weight aur baki details store karne ke liye
  @Column({ type: "json", nullable: true })
  details!: any; 

  @CreateDateColumn()
  createdAt!: Date;
}