"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Hospital = {
    id: string;
    name: string;
};

export default function HospitalSelection() {
    const [hospitals, setHospitals] = useState<Hospital[]>([]);
    const router = useRouter();

    useEffect(() => {
        if (!auth.currentUser) {
            router.push("/");
            return;
        }

        const fetchHospitals = async () => {
            const user_id = auth.currentUser!.uid;
            const user_email = auth.currentUser!.email;
            console.log(user_email);
            console.log(user_id);;

            const hospitalsSnapshot = await getDocs(collection(db, "hospitals"));
            console.log(hospitalsSnapshot.docs);
            const allHospitals: Hospital[] = hospitalsSnapshot.docs.map((doc) => ({
                id: doc.id,
                name: doc.data().name,
            }));

            const hospitalData: Hospital[] = [];
            if (user_email == null) {
                return "Error";
            }
            await Promise.all(
                allHospitals.map(async (hospital) => {
                console.log(hospital.id);
                const apptSnapshot = await getDocs(
                    collection(db, "appointments", user_email, hospital.id)
                );
                if (!apptSnapshot.empty) {
                    hospitalData.push(hospital);
                }
                })
            );

            setHospitals(hospitalData);
        };

        fetchHospitals();
    }, [router]);

    const handleSelect = (hospitalId: string) => {
        router.push(`home/?hospital=${hospitalId}`);
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <Card className="w-full max-w-md">
            <CardHeader>
            <CardTitle>Select Your Hospital</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
            {hospitals.length === 0 ? (
                <p>No appointments found.</p>
            ) : (
                hospitals.map((hospital) => (
                <Button
                    key={hospital.id}
                    variant="outline"
                    onClick={() => handleSelect(hospital.id)}
                >
                    {hospital.name}
                </Button>
                ))
            )}
            </CardContent>
        </Card>
        </div>
    );
}