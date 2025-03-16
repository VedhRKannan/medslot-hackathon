"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
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
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, addMonths, subMonths, isWithinInterval, startOfDay, isEqual } from "date-fns";

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

function LoadingFallback() {
    return <div className="p-8">Loading...</div>;
  }

export default function Home() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const hospitalId = searchParams.get("hospital");
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [availableSlots, setAvailableSlots] = useState<Appointment[]>([]);
    const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
    const [confirmedSwaps, setConfirmedSwaps] = useState<SwapRequest[]>([]);
    const [swapFormOpen, setSwapFormOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (!auth.currentUser) {
                router.push("/");
                return;
            }

            
            const fetchData = async () => {
                const userId = auth.currentUser!.email;
                console.log(userId);
                console.log(hospitalId);
                
                if (!userId || !hospitalId) {
                    console.error("Error: userId or hospitalId is missing.");
                    return;
                }

                if (!hospitalId) {
                    router.push("/hospital");
                    return;
                }
                
                const apptRef = collection(db, "appointments", userId, hospitalId);
                const apptSnapshot = await getDocs(apptRef);
                
                console.log(apptSnapshot);
                const apptData = apptSnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                })) as Appointment[];
                setAppointments(apptData);
                
                console.log("EmptySnapshot");
                const emptySnapshot = await getDocs(collection(db, "appointments", "empty", hospitalId));
                console.log("EmptySnapshot End");
                console.log(emptySnapshot);
                const emptyData = emptySnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                })) as Appointment[];
                setAvailableSlots(emptyData);
                
                console.log("SwapSnapshot");
                const swapSnapshot = await getDocs(collection(db, "hospitals", hospitalId, "swapRequests"));
                console.log(swapSnapshot);
                console.log("SwapSnapshot End");
                const swapData = swapSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as SwapRequest));
                const userSwaps = swapData.filter((req) => req.user_id === auth.currentUser!.email);
                const pendingSwaps = userSwaps.filter((req) => req.pending);
                const validPendingSwaps = await Promise.all(
                pendingSwaps.map(async (req) => {
                    const apptRef = collection(db, "appointments", req.user_id, hospitalId, req.appt_id);
                    const apptSnap = await getDocs(apptRef);
                    const appt = apptSnap.docs.find((doc) => doc.id === req.appt_id);
                    return appt && !isBefore(appt.data().date.toDate(), startOfDay(new Date())) ? req : null;
                })
                );
                setSwapRequests(validPendingSwaps.filter((req) => req !== null) as SwapRequest[]);
                setConfirmedSwaps(userSwaps.filter((req) => !req.pending));
            };

            fetchData();
        });
        return () => unsubscribe();
    }, [hospitalId, router]);

    const daysInMonth = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth),
    });

    const handleDayClick = (date: Date) => {
        setSelectedDate(date.toString());
        setDialogOpen(true);
    };

    const appointmentForDate = (date: Date) =>
        appointments.find((appt) => isEqual(appt.date.toDate(), date));

    const checkForSwapMatches = async (newRequest: SwapRequest) => {
        if (!hospitalId) {
            console.error("Error: userId or hospitalId is missing.");
            return;
        }
        const swapRequestsRef = collection(db, "hospitals", hospitalId?.toString(), "swapRequests");

        const allRequests = await getDocs(swapRequestsRef);
        const potentialMatches: SwapRequest[] = [];

        console.log(allRequests.docs);
        for (const doc of allRequests.docs) {
            const req = doc.data() as SwapRequest;

            // Initial synchronous filtering
            if (
                req.clinic !== newRequest.clinic ||
                !req.pending ||
                req.user_id === newRequest.user_id
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
            req.pref_dates.some((range) =>
                isWithinInterval(myDate, { start: range.from.toDate(), end: range.to.toDate() })
            ) &&
            newRequest.pref_dates.some((range) =>
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
                if (auth.currentUser == null || auth.currentUser.email == null || !hospitalId) {
                    console.error("Error: userId or hospitalId is missing.");
                    return;
                }
                await setDoc(
                    doc(db, "appointments", auth.currentUser.email.toString(), hospitalId.toString(), myAppt.id),
                    { ...myAppt, date: theirAppt.date },
                    { merge: true }
                );
                await setDoc(
                    doc(db, "appointments", match.user_id, hospitalId?.toString(), theirAppt.id),
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
                    prev.map((req) => (req.id === newRequest.id || req.id === match.id) ? { ...req, pending: false } : req)
                );
                setConfirmedSwaps((prev) => [...prev, { ...newRequest, pending: false }, { ...match, pending: false }]);
            }
        }
    };

    const handleSwapRequest = async (appt_id: string, pref_dates: PrefDates[]) => {
        if (!hospitalId || !auth.currentUser) return;
            const appt = appointments.find((a) => a.id === appt_id);
        if (!appt) return;
        if (auth.currentUser == null || auth.currentUser.email == null) {
            console.error("Error: userId is missing.");
            return;
        }
        const swapRequest: SwapRequest = {
            id: `${auth.currentUser.uid}-${Date.now()}`,
            user_id: auth.currentUser.email,
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
        console.log(appt_id);
        console.log(hospitalId);
        if (!hospitalId || !auth.currentUser) return;

        if (auth.currentUser == null || auth.currentUser.email == null || !hospitalId) {
            console.error("Error: userId or hospitalId is missing.");
            return;
        }
        const apptRef = doc(db, "appointments", auth.currentUser.email.toString(), hospitalId.toString(), appt_id);

        const apptSnapshot = await getDoc(apptRef);
        if (!apptSnapshot.exists()) {
            console.error("Appointment not found");
            return;
        }
        const apptData = apptSnapshot.data() as Appointment;
        await deleteDoc(apptRef);
        const emptyRef = doc(db, "appointments", "empty", hospitalId, appt_id);
        await setDoc(emptyRef, apptData);

        // Step 4: Update local state
        setAppointments((prev) => prev.filter((appt) => appt.id !== appt_id));
        setAvailableSlots((prev) => [...prev, { ...apptData, id: appt_id }]);
        setDialogOpen(false);
    };
    
    const matchAppointment = () => {
        if (!selectedDate) return null;
        const parsedDate = selectedDate.toString()
        const normalizedDate = startOfDay(parsedDate);
        return appointments.find((appt) => {
            const normalizedApptDate = startOfDay(appt.date.toDate()).toString();
            return isEqual(normalizedDate, normalizedApptDate);
        });
    };

    const daysInMonthFiltered = daysInMonth.filter((day) => !isBefore(day, startOfDay(new Date())));

    return (
        <Suspense fallback={<LoadingFallback />}>
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
                    {daysInMonthFiltered.map((day) => {
                        const hasAppt = appointmentForDate(day);
                        const hasAvailable = availableSlots.find((slot) => 
                            isEqual(startOfDay(slot.date.toDate()), startOfDay(day))
                        );
                        const isPast = isBefore(day, new Date());
                        return (
                            <Button
                            key={day.toString()}
                            variant={hasAppt ? "default" : hasAvailable ? "secondary" : "outline"}
                            disabled={isPast}
                            className={`h-16 ${isPast ? "bg-gray-200 text-gray-500" : ""}`}
                            onClick={() => handleDayClick(day)}
                            >
                            {format(day, "d")}
                            {hasAppt && <span className="text-xs"> (Booked)</span>}
                            {hasAvailable && !hasAppt && <span className="text-xs"> (Available)</span>}
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
                            Swap for {format(appointments.find((appt) => appt.id === req.appt_id)?.date.toDate() || new Date(), "yyyy-MM-dd")} -{" "}
                            {req.pending ? "Pending" : "Matched"}
                            </li>
                        ))}
                        </ul>
                    )}
                    </CardContent>
                </Card>

                <Card className="mt-8">
                    <CardHeader>
                        <CardTitle>Confirmed Swaps</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {confirmedSwaps.length === 0 ? (
                        <p>No confirmed swaps</p>
                        ) : (
                        <ul>
                            {confirmedSwaps.map((swap) => (
                            <li key={swap.id}>
                                Swapped {format(appointments.find((appt) => appt.id === swap.appt_id)?.date.toDate() || new Date(), "MMMM d, yyyy")}
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
                            <DialogTitle>{format(new Date(selectedDate || ""), "MMMM d, yyyy")}</DialogTitle>
                        </DialogHeader>
                        {(() => {
                            const appt = matchAppointment();
                            if (!appt) return <p>No appointment scheduled.</p>;
                            return (
                            <div className="space-y-4">
                                <p>Location: {appt.location}</p>
                                <p>Clinic: {appt.clinic}</p>
                                <Button variant="destructive" onClick={() => handleCancel(appt.id)}>
                                Cancel Appointment
                                </Button>
                                <Button onClick={() => setSwapFormOpen(true)}>
                                Request Swap
                                </Button>
                                {swapFormOpen && (
                                <SwapForm appt_id={appt.id} onSubmit={handleSwapRequest} availableSlots={availableSlots} />
                                )}
                            </div>
                            );
                        })()}
                        </DialogContent>
                    </Dialog>
                )}
            </div>
        </Suspense>
    );
}

function SwapForm({
    appt_id,
    availableSlots,
    onSubmit,
    }: {
    appt_id: string;
    availableSlots: Appointment[],
    onSubmit: (appt_id: string, prefDates: PrefDates[]) => void;
    }) {
    const [selectedRange, setSelectedRange] = useState<PrefDates | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedRange) {
        onSubmit(appt_id, [selectedRange]);
        setSelectedRange(null);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-lg font-semibold">Request a Swap</h3>
        <select
            value={selectedRange ? format(selectedRange.from.toDate(), "yyyy-MM-dd") : ""}
            onChange={(e) => {
            const slot = availableSlots.find((s) =>
                format(s.date.toDate(), "yyyy-MM-dd") === e.target.value
            );
            if (slot) {
                setSelectedRange({ from: slot.date, to: slot.date });
            }
            }}
            className="w-full p-2 border rounded"
        >
            <option value="">Select an available slot</option>
            {availableSlots
            .filter((slot) => !isBefore(slot.date.toDate(), new Date()))
            .map((slot) => (
                <option key={slot.id} value={format(slot.date.toDate(), "yyyy-MM-dd")}>
                {format(slot.date.toDate(), "MMMM d, yyyy")}
                </option>
            ))}
        </select>
        <Button type="submit" disabled={!selectedRange}>Submit Swap Request</Button>
        </form>
    );
}