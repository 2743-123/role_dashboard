import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from "typeorm";
import { User } from "./User";


@Entity()
export class BedashMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (user) => user.bedashMessages, { onDelete: "CASCADE" })
  user!: User;

  @Column({ type: "float" })
  amount!: number; // tons

  @Column({ type: "varchar", length: 20, default: "bedash" })
  materialType!: string;

 @Column({ type: "date", nullable: true })
customDate!: Date | null;

  @Column({ type: "date", nullable: true })
  targetDate!: Date | null; // completion target

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: "pending" | "completed";

  @CreateDateColumn()
  createdAt!: Date;
}
