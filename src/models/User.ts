import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { MaterialAccount } from "./materialaccount";
import { Token } from "./Token";

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

  @Column({ default: "user" }) // user | admin
  role!: string;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => MaterialAccount, (account) => account.user)
  accounts!: MaterialAccount[];

  @OneToMany(() => Token, (token) => token.user)
  tokens!: Token[];

  @Column({ nullable: true })
createdBy?: number; // stores superadmin id

}
