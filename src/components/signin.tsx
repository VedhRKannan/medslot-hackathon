"use client"; // Required for client-side Firebase

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Button } from "@/components/ui/button"; // shadcn button
import { Input } from "@/components/ui/input"; // shadcn input

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      console.log("Signed in successfully!");
      // Redirect or update state as needed
    } catch (err: unknown) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Sign In</h1>
      <form onSubmit={handleSignIn} className="flex flex-col gap-4 w-80">
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit">Sign In</Button>
      </form>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}