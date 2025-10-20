import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User";
@Entity()
export class Token {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  customerName!: string;

  @Column()
  truckNumber!: string;

  @Column()
  materialType!: "flyash" | "bedash";

  @Column({ type: "numeric", default: 0 })
  weight!: number;

  @Column({ type: "numeric", default: 0 })
  ratePerTon!: number;

  @Column({ type: "numeric", default: 0 })
  commission!: number;

  @Column({ type: "numeric", default: 0 })
  totalAmount!: number;

  @Column({ type: "numeric", default: 0 })
  paidAmount!: number;

  @Column({ type: "numeric", default: 0 })
  carryForward!: number;

  @Column({ default: "pending" })
  status!: "pending" | "updated" | "completed";

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.tokens, {
  onDelete: "CASCADE", // 👈 this line is key
  onUpdate: "CASCADE", // optional but good practice
})
user!: User;
}

