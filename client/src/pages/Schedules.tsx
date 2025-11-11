import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import {
  Calendar,
  Clock,
  Plus,
  Edit,
  Trash2,
  Search,
  Truck,
  User,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Schedule, Driver } from "@shared/schema";

// Form schema
const scheduleFormSchema = z.object({
  driverId: z.string().min(1, "Driver is required"),
  truckId: z.string().optional(),
  routeId: z.string().optional(),
  contractId: z.string().optional(),
  scheduledDate: z.string().min(1, "Scheduled date is required"),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
  notes: z.string().optional(),
});

type ScheduleFormData = z.infer<typeof scheduleFormSchema>;

export default function Schedules() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<Schedule | null>(null);

  // Fetch schedules
  const { data: schedules = [], isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });

  // Fetch drivers for selection
  const { data: drivers = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
  });

  // Filter schedules
  const filteredSchedules = schedules.filter((schedule) => {
    const searchLower = searchQuery.toLowerCase();
    const driver = drivers.find((d) => d.id === schedule.driverId);
    const driverName = driver ? `${driver.firstName} ${driver.lastName}` : "";
    return (
      driverName.toLowerCase().includes(searchLower) ||
      schedule.status.toLowerCase().includes(searchLower) ||
      schedule.notes?.toLowerCase().includes(searchLower)
    );
  });

  // Get driver name helper
  const getDriverName = (driverId: string) => {
    const driver = drivers.find((d) => d.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : "Unknown Driver";
  };

  // Status badge variant
  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "scheduled":
        return "default";
      case "in_progress":
        return "secondary";
      case "completed":
        return "outline";
      case "cancelled":
        return "destructive";
      default:
        return "default";
    }
  };

  // Format status for display
  const formatStatus = (status: string) => {
    return status
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Add schedule form
  const addScheduleForm = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      driverId: "",
      truckId: "",
      routeId: "",
      contractId: "",
      scheduledDate: "",
      startTime: "",
      endTime: "",
      status: "scheduled",
      notes: "",
    },
  });

  const addScheduleMutation = useMutation({
    mutationFn: async (data: ScheduleFormData) => {
      const cleanedData = {
        ...data,
        truckId: data.truckId || undefined,
        routeId: data.routeId || undefined,
        contractId: data.contractId || undefined,
        startTime: data.startTime || undefined,
        endTime: data.endTime || undefined,
        notes: data.notes || undefined,
      };
      return apiRequest("POST", "/api/schedules", cleanedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setAddDialogOpen(false);
      addScheduleForm.reset();
      toast({
        title: "Schedule created",
        description: "The schedule has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to create schedule",
      });
    },
  });

  // Edit schedule form
  const editScheduleForm = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleFormSchema),
  });

  const editScheduleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ScheduleFormData> }) => {
      const cleanedData = {
        ...data,
        truckId: data.truckId || undefined,
        routeId: data.routeId || undefined,
        contractId: data.contractId || undefined,
        startTime: data.startTime || undefined,
        endTime: data.endTime || undefined,
        notes: data.notes || undefined,
      };
      return apiRequest("PATCH", `/api/schedules/${id}`, cleanedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setEditingSchedule(null);
      toast({
        title: "Schedule updated",
        description: "The schedule has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update schedule",
      });
    },
  });

  // Delete schedule
  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      setDeletingSchedule(null);
      toast({
        title: "Schedule deleted",
        description: "The schedule has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete schedule",
      });
    },
  });

  // Handle edit click
  const handleEditClick = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    editScheduleForm.reset({
      driverId: schedule.driverId,
      truckId: schedule.truckId || "",
      routeId: schedule.routeId || "",
      contractId: schedule.contractId || "",
      scheduledDate: format(new Date(schedule.scheduledDate), "yyyy-MM-dd"),
      startTime: schedule.startTime ? format(new Date(schedule.startTime), "yyyy-MM-dd'T'HH:mm") : "",
      endTime: schedule.endTime ? format(new Date(schedule.endTime), "yyyy-MM-dd'T'HH:mm") : "",
      status: schedule.status as any,
      notes: schedule.notes || "",
    });
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading schedules...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Schedules</h1>
        <p className="text-muted-foreground">
          Manage driver schedules and assignments
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex-1 max-w-sm relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search schedules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-schedules"
          />
        </div>
        <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-schedule">
          <Plus className="h-4 w-4 mr-2" />
          Add Schedule
        </Button>
      </div>

      <div className="mb-4">
        <p className="text-sm text-muted-foreground" data-testid="text-schedule-count">
          {filteredSchedules.length} {filteredSchedules.length === 1 ? "schedule" : "schedules"} found
        </p>
      </div>

      {filteredSchedules.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchQuery ? "No schedules found matching your search" : "No schedules created yet"}
          </p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead>Scheduled Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSchedules.map((schedule) => (
                <TableRow key={schedule.id} data-testid={`row-schedule-${schedule.id}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {getDriverName(schedule.driverId)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {format(new Date(schedule.scheduledDate), "MMM dd, yyyy")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 text-sm">
                      {schedule.startTime && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Start: {format(new Date(schedule.startTime), "HH:mm")}
                        </div>
                      )}
                      {schedule.endTime && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          End: {format(new Date(schedule.endTime), "HH:mm")}
                        </div>
                      )}
                      {!schedule.startTime && !schedule.endTime && (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(schedule.status)}>
                      {formatStatus(schedule.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {schedule.notes || "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditClick(schedule)}
                        data-testid={`button-edit-schedule-${schedule.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingSchedule(schedule)}
                        data-testid={`button-delete-schedule-${schedule.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Schedule Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent data-testid="dialog-add-schedule">
          <DialogHeader>
            <DialogTitle>Create New Schedule</DialogTitle>
            <DialogDescription>
              Assign a driver to a schedule with date and time details.
            </DialogDescription>
          </DialogHeader>
          <Form {...addScheduleForm}>
            <form
              onSubmit={addScheduleForm.handleSubmit((data) => addScheduleMutation.mutate(data))}
              className="space-y-4"
            >
              <FormField
                control={addScheduleForm.control}
                name="driverId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Driver *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-driver">
                          <SelectValue placeholder="Select a driver" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {drivers.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.firstName} {driver.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={addScheduleForm.control}
                name="scheduledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-scheduled-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={addScheduleForm.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time (Optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-start-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addScheduleForm.control}
                  name="endTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time (Optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-end-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={addScheduleForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={addScheduleForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Add any additional notes..."
                        data-testid="input-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={addScheduleMutation.isPending} data-testid="button-submit-add-schedule">
                  {addScheduleMutation.isPending ? "Creating..." : "Create Schedule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Schedule Dialog */}
      <Dialog open={!!editingSchedule} onOpenChange={(open) => !open && setEditingSchedule(null)}>
        <DialogContent data-testid="dialog-edit-schedule">
          <DialogHeader>
            <DialogTitle>Edit Schedule</DialogTitle>
            <DialogDescription>
              Update the schedule details.
            </DialogDescription>
          </DialogHeader>
          <Form {...editScheduleForm}>
            <form
              onSubmit={editScheduleForm.handleSubmit((data) =>
                editScheduleMutation.mutate({ id: editingSchedule!.id, data })
              )}
              className="space-y-4"
            >
              <FormField
                control={editScheduleForm.control}
                name="driverId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Driver *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-driver">
                          <SelectValue placeholder="Select a driver" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {drivers.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.firstName} {driver.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editScheduleForm.control}
                name="scheduledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scheduled Date *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-edit-scheduled-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editScheduleForm.control}
                  name="startTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Time (Optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-edit-start-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editScheduleForm.control}
                  name="endTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Time (Optional)</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} data-testid="input-edit-end-time" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editScheduleForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="scheduled">Scheduled</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editScheduleForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Add any additional notes..."
                        data-testid="input-edit-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingSchedule(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editScheduleMutation.isPending} data-testid="button-submit-edit-schedule">
                  {editScheduleMutation.isPending ? "Updating..." : "Update Schedule"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingSchedule} onOpenChange={(open) => !open && setDeletingSchedule(null)}>
        <AlertDialogContent data-testid="dialog-delete-schedule">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the schedule for{" "}
              <span className="font-semibold">
                {deletingSchedule && getDriverName(deletingSchedule.driverId)}
              </span>
              {" "}on{" "}
              <span className="font-semibold">
                {deletingSchedule && format(new Date(deletingSchedule.scheduledDate), "MMM dd, yyyy")}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingSchedule && deleteScheduleMutation.mutate(deletingSchedule.id)}
              disabled={deleteScheduleMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteScheduleMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
