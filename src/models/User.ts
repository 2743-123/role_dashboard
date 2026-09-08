import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { MaterialAccount } from "./materialaccount";
import { Token } from "./Token";
import { Transaction } from "./Transaction";
import { BedashMessage } from "./bedashMessage";

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ default: "Unknown" })
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ default: "user" }) // user | admin | superadmin
  role!: string;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => MaterialAccount, (account) => account.user)
  accounts!: MaterialAccount[];

  @OneToMany(() => Token, (token) => token.user)
  tokens!: Token[];

  @OneToMany(() => Transaction, (transaction) => transaction.user)
  transactions!: Transaction[];

  @OneToMany(() => BedashMessage, (msg) => msg.user)
  bedashMessages!: BedashMessage[];

  // ✅ SIRF RELATION RAKHNA HAI (Explicit Column hata diya gaya hai)
  @ManyToOne(() => User, (user) => user.children, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "createdBy" }) // TypeORM automatically database me 'createdBy' integer column bana dega
  creator?: User;

  @OneToMany(() => User, (user) => user.creator)
  children!: User[];

  @OneToMany(() => BedashMessage, (bedash) => bedash.createdBy)
  createdBedash!: BedashMessage[];
}