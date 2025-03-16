"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, addMonths, subMonths, isWithinInterval, startOfDay } from "date-fns";

type Appointment = {
    id: string;
    date: Timestamp;
    location: string;
    clinic: string;
};

type PrefDates = {
    from: Timestamp;
    to: Timestamp;
};

type SwapRequest = {
    id: string;
    user_id: string;
    appt_id: string;
    pref_dates: PrefDates[];
    clinic: string;
    pending: boolean;
};

export default function Home() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const hospitalId = searchParams.get("hospital");
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        if (!auth.currentUser) {
            router.push("/");
            return;
        }
        if (!hospitalId) {
            router.push("/hospital");
            return;
        }

        const fetchData = async () => {
        const userId = auth.currentUser!.email;

        const apptSnapshot = await getDocs(
            collection(db, "appointments", userId, hospitalId)
        );
        console.log(apptSnapshot.docs);
        const apptData = apptSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Appointment[];
        setAppointments(apptData);

        const swapSnapshot = await getDocs(
            query(collection(db, "hospitals", hospitalId, "swapRequests"), where("user_id", "==", userId))
        );
        console.log(swapSnapshot.docs);
        const swapData = swapSnapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() } as SwapRequest));
        setSwapRequests(swapData);
        };

        fetchData();
    }, [hospitalId, router]);

    const daysInMonth = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth),
    });

    const handleDayClick = (date: Timestamp) => {
        setSelectedDate(date);
        setDialogOpen(true);
    };

    const appointmentForDate = (date: Timestamp) =>
        appointments.find((appt) => appt.date.isEqual(date));

    const checkForSwapMatches = async (newRequest: SwapRequest) => {
        const allRequests = await getDocs(
            query(collection(db, "hospitals", hospitalId, "swapRequests"), where("clinic", "==", newRequest.clinic))
        );
        const potentialMatches: SwapRequest[] = [];

        console.log(allRequests.docs);
        for (const doc of allRequests.docs) {
            const req = doc.data() as SwapRequest;

            // Initial synchronous filtering
            if (
                req.clinic !== newRequest.clinic ||
                !req.pending ||
                req.userId === newRequest.user_id
            ) {
                continue;
            }

            // Step 2: Get appointment data
            const myAppt = appointments.find((appt) => appt.id === newRequest.appt_id);
            if (!myAppt) continue;

            const theirApptSnap = await getDocs(
                collection(db, "appointments", req.user_id, hospitalId!)
            );
            const theirAppt = theirApptSnap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() } as Appointment))
                .find((appt) => appt.id === req.appt_id);

            if (!theirAppt) continue;

            // Step 3: Check date ranges
            const myDate = myAppt.date.toDate();
            const theirDate = theirAppt.date.toDate();

            const isMatch =
            req.prefDates.some((range) =>
                isWithinInterval(myDate, { start: range.from.toDate(), end: range.to.toDate() })
            ) &&
            newRequest.prefDates.some((range) =>
                isWithinInterval(theirDate, { start: range.from.toDate(), end: range.to.toDate() })
            );

            if (isMatch) {
                potentialMatches.push(req);
            }
        }

        // Step 4: Process the first match (if any)
        if (potentialMatches.length > 0) {
            const match = potentialMatches[0];
            const myAppt = appointments.find((appt) => appt.id === newRequest.appt_id);
            const theirApptSnap = await getDocs(
                collection(db, "appointments", match.user_id, hospitalId!)
            );
            const theirAppt = theirApptSnap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() } as Appointment))
                .find((appt) => appt.id === match.appt_id);

            if (myAppt && theirAppt) {
                await setDoc(
                    doc(db, "appointments", auth.currentUser!.email, hospitalId!, myAppt.id),
                    { ...myAppt, date: theirAppt.date },
                    { merge: true }
                );
                await setDoc(
                    doc(db, "appointments", match.user_id, hospitalId!, theirAppt.id),
                    { ...theirAppt, date: myAppt.date },
                    { merge: true }
                );

                await setDoc(
                    doc(db, "hospitals", hospitalId!, "swapRequests", newRequest.id),
                    { ...newRequest, pending: false },
                    { merge: true }
                );
                await setDoc(
                    doc(db, "hospitals", hospitalId!, "swapRequests", match.id),
                    { ...match, pending: false },
                    { merge: true }
                );

                setAppointments((prev) =>
                    prev.map((appt) =>
                    appt.id === myAppt.id ? { ...appt, date: theirAppt.date } : appt
                    )
                );
                setSwapRequests((prev) =>
                    prev.map((req) =>
                    req.id === newRequest.id ? { ...req, pending: false } : req
                    )
                );
            }
        }
    };

    const handleSwapRequest = async (appt_id: string, pref_dates: PrefDates[]) => {
        if (!hospitalId || !auth.currentUser) return;
            const appt = appointments.find((a) => a.id === appt_id);
        if (!appt) return;

        const swapRequest: SwapRequest = {
            id: `${auth.currentUser.uid}-${Date.now()}`,
            userId: auth.currentUser.uid,
            appt_id,
            pref_dates,
            clinic: appt.clinic,
            pending: true,
        };

        await setDoc(
            doc(db, "hospitals", hospitalId, "swapRequests", swapRequest.id),
            swapRequest
        );
        setSwapRequests([...swapRequests, swapRequest]);
        await checkForSwapMatches(swapRequest);
        setDialogOpen(false);
    };
    
    const handleCancel = async (appt_id: string) => {
        if (!hospitalId || !auth.currentUser) return;
        await deleteDoc(doc(db, "appointments", auth.currentUser!.uid, hospitalId, appt_id));
        setAppointments(appointments.filter((appt) => appt.id !== appt_id));
        setDialogOpen(false);
    };
    
    return (
        <div className="p-8">
            <div className="flex items-center">
                <h1 className="text-3xl font-bold mb-4">Your Appointments</h1>
                <Button onClick={() => router.push("/hospital")} className="ml-4">
                    Change Hospital
                </Button>
            </div>
        
            <div className="flex justify-between mb-4">
                <Button
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                    disabled={isBefore(subMonths(currentMonth, 1), startOfMonth(new Date()))}
                >
                    Previous Month
                </Button>
                <span className="text-xl">{format(currentMonth, "MMMM yyyy")}</span>
                <Button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                    Next Month
                </Button>
            </div>
        
            <div className="grid grid-cols-7 gap-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="text-center font-bold">{day}</div>
                ))}
                {daysInMonth.map((day) => {
                const hasAppt = appointmentForDate(day);
                const isPast = isBefore(day, new Date()) && format(day, "yyyy-MM") === format(new Date(), "yyyy-MM");
                return (
                    <Button
                    key={day.toISOString()}
                    variant={hasAppt ? "default" : "outline"}
                    disabled={isPast}
                    className={`h-16 ${isPast ? "bg-gray-200 text-gray-500" : ""}`}
                    onClick={() => handleDayClick(day)}
                    >
                    {format(day, "d")}
                    {hasAppt && <span className="text-xs"> (Appt)</span>}
                    </Button>
                );
                })}
            </div>
    
            <Card className="mt-8">
                <CardHeader>
                <CardTitle>Pending Swap Requests</CardTitle>
                </CardHeader>
                <CardContent>
                {swapRequests.length === 0 ? (
                    <p>No pending requests</p>
                ) : (
                    <ul>
                    {swapRequests.map((req) => (
                        <li key={req.id}>
                        Swap for {format(appointments.find((appt) => appt.id === req.apptId)?.date.toDate() || new Date(), "yyyy-MM-dd")} -{" "}
                        {req.pending ? "Pending" : "Matched"}
                        </li>
                    ))}
                    </ul>
                )}
                </CardContent>
            </Card>
    
            {selectedDate && (
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                    <DialogTitle>{format(new Date(selectedDate), "MMMM d, yyyy")}</DialogTitle>
                    </DialogHeader>
                    {(() => {
                        console.log(startOfDay(appointments[0].date.toDate()).toString());
                        console.log("selected: %s", selectedDate.toString());
                        const appt = appointments.find((a) => startOfDay(a.date.toDate()).toString() == selectedDate.toString());
                        if (!appt) return <p>No appointment scheduled.</p>;
                        return (
                            <div className="space-y-4">
                            <p>Location: {appt.location}</p>
                            <p>Clinic: {appt.clinic}</p>
                            <Button variant="destructive" onClick={() => handleCancel(appt.id)}>
                                Cancel Appointment
                            </Button>
                            <SwapForm appointmentId={appt.id} onSubmit={handleSwapRequest} />
                            </div>
                    );
                    })()}
                </DialogContent>
                </Dialog>
            )}
        </div>
    );
}

function SwapForm({
    appt_id,
    onSubmit,
    }: {
    appt_id: string;
    onSubmit: (appt_id: string, prefDates: PrefDates[]) => void;
    }) {
    const [ranges, setRanges] = useState<PrefDates[]>([
        { from: Timestamp.fromDate(new Date()), to: Timestamp.fromDate(new Date()) },
        { from: Timestamp.fromDate(new Date()), to: Timestamp.fromDate(new Date()) },
    ]);
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(appt_id, ranges);
    };
    
    return (
        <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-lg font-semibold">Request a Swap</h3>
        {ranges.map((range, i) => (
            <div key={i} className="space-y-2">
            <div>
                <label>From:</label>
                <Input
                type="date"
                value={format(range.from.toDate(), "yyyy-MM-dd")}
                onChange={(e) =>
                    setRanges((prev) =>
                    prev.map((r, idx) =>
                        idx === i ? { ...r, from: Timestamp.fromDate(new Date(e.target.value)) } : r
                    )
                    )
                }
                min={format(new Date(), "yyyy-MM-dd")}
                />
            </div>
            <div>
                <label>To:</label>
                <Input
                type="date"
                value={format(range.to.toDate(), "yyyy-MM-dd")}
                onChange={(e) =>
                    setRanges((prev) =>
                    prev.map((r, idx) =>
                        idx === i ? { ...r, to: Timestamp.fromDate(new Date(e.target.value)) } : r
                    )
                    )
                }
                min={format(range.from.toDate(), "yyyy-MM-dd")}
                />
            </div>
            </div>
        ))}
        <Button type="submit">Submit Swap Request</Button>
        </form>
    );
}