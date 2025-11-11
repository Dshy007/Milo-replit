import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLoadSchema, type Load, type InsertLoad, type Schedule } from "@shared/schema";
import { Plus, Pencil, Trash2, Search, Package } from "lucide-react";
import { format } from "date-fns";

export default function Loads() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedLoad, setSelectedLoad] = useState<Load | null>(null);

  const { data: loads = [], isLoading } = useQuery<Load[]>({
    queryKey: ["/api/loads"],
  });

  const { data: schedules = [] } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
  });

  const addForm = useForm<InsertLoad>({
    resolver: zodResolver(insertLoadSchema.omit({ tenantId: true })),
    defaultValues: {
      loadNumber: "",
      pickupLocation: "",
      deliveryLocation: "",
      pickupTime: new Date(),
      deliveryTime: new Date(),
      weight: "",
      description: "",
      status: "pending",
      scheduleId: "none",
    },
  });

  const editForm = useForm<InsertLoad>({
    resolver: zodResolver(insertLoadSchema.omit({ tenantId: true })),
  });

  const cleanLoadData = (data: InsertLoad) => {
    return {
      ...data,
      scheduleId: data.scheduleId && data.scheduleId !== "" && data.scheduleId !== "none" ? data.scheduleId : undefined,
      weight: data.weight && data.weight !== "" ? data.weight : undefined,
      description: data.description && data.description !== "" ? data.description : undefined,
    };
  };

  const addLoadMutation = useMutation({
    mutationFn: async (data: InsertLoad) => {
      const cleanedData = cleanLoadData(data);
      const response = await apiRequest("POST", "/api/loads", cleanedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      setAddDialogOpen(false);
      addForm.reset();
      toast({
        title: "Success",
        description: "Load added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add load",
      });
    },
  });

  const editLoadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertLoad> }) => {
      const cleanedData = cleanLoadData(data as InsertLoad);
      const response = await apiRequest("PATCH", `/api/loads/${id}`, cleanedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      setEditDialogOpen(false);
      setSelectedLoad(null);
      toast({
        title: "Success",
        description: "Load updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update load",
      });
    },
  });

  const deleteLoadMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/loads/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loads"] });
      setDeleteDialogOpen(false);
      setSelectedLoad(null);
      toast({
        title: "Success",
        description: "Load deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete load",
      });
    },
  });

  const filteredLoads = loads.filter((load) => {
    const matchesSearch =
      load.loadNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.pickupLocation.toLowerCase().includes(searchTerm.toLowerCase()) ||
      load.deliveryLocation.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || load.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleEdit = (load: Load) => {
    setSelectedLoad(load);
    editForm.reset({
      loadNumber: load.loadNumber,
      pickupLocation: load.pickupLocation,
      deliveryLocation: load.deliveryLocation,
      pickupTime: new Date(load.pickupTime),
      deliveryTime: new Date(load.deliveryTime),
      weight: load.weight || "",
      description: load.description || "",
      status: load.status,
      scheduleId: load.scheduleId || "none",
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (load: Load) => {
    setSelectedLoad(load);
    setDeleteDialogOpen(true);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "pending":
        return "outline";
      case "picked_up":
        return "secondary";
      case "in_transit":
        return "default";
      case "delivered":
        return "default";
      case "cancelled":
        return "destructive";
      default:
        return "outline";
    }
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case "pending":
        return "Pending";
      case "picked_up":
        return "Picked Up";
      case "in_transit":
        return "In Transit";
      case "delivered":
        return "Delivered";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading loads...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <Package className="w-5 h-5 text-primary" data-testid="loads-icon" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
              Loads
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
              Manage freight loads and shipments
            </p>
          </div>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-load">
              <Plus className="w-4 h-4 mr-2" />
              Add Load
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Load</DialogTitle>
              <DialogDescription>
                Create a new freight load
              </DialogDescription>
            </DialogHeader>
            <Form {...addForm}>
              <form
                onSubmit={addForm.handleSubmit((data) => addLoadMutation.mutate(data))}
                className="space-y-4"
              >
                <FormField
                  control={addForm.control}
                  name="loadNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Load Number *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="LD-001"
                          data-testid="input-load-number"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>Unique load identifier</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="pickupLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup Location *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="123 Main St, City, ST 12345"
                          data-testid="input-pickup-location"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="deliveryLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Location *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="456 Oak Ave, City, ST 54321"
                          data-testid="input-delivery-location"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="pickupTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup Time *</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          data-testid="input-pickup-time"
                          {...field}
                          value={
                            field.value instanceof Date
                              ? format(field.value, "yyyy-MM-dd'T'HH:mm")
                              : ""
                          }
                          onChange={(e) => field.onChange(new Date(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="deliveryTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery Time *</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          data-testid="input-delivery-time"
                          {...field}
                          value={
                            field.value instanceof Date
                              ? format(field.value, "yyyy-MM-dd'T'HH:mm")
                              : ""
                          }
                          onChange={(e) => field.onChange(new Date(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight (lbs)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          data-testid="input-weight"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormDescription>Optional</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="picked_up">Picked Up</SelectItem>
                          <SelectItem value="in_transit">In Transit</SelectItem>
                          <SelectItem value="delivered">Delivered</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="scheduleId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Schedule</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                        defaultValue={field.value || "none"}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-schedule">
                            <SelectValue placeholder="Select schedule (optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {schedules.map((schedule) => (
                            <SelectItem key={schedule.id} value={schedule.id}>
                              {format(new Date(schedule.scheduledDate), "MMM dd, yyyy")} - {schedule.status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Optional</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Load details and notes..."
                          data-testid="input-description"
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormDescription>Optional</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                    data-testid="button-cancel-add"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={addLoadMutation.isPending}
                    data-testid="button-submit-add"
                  >
                    {addLoadMutation.isPending ? "Adding..." : "Add Load"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by load number or location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter-status">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="picked_up">Picked Up</SelectItem>
                <SelectItem value="in_transit">In Transit</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground" data-testid="text-count">
            {filteredLoads.length} {filteredLoads.length === 1 ? "load" : "loads"}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Load Number</TableHead>
                  <TableHead>Pickup Location</TableHead>
                  <TableHead>Delivery Location</TableHead>
                  <TableHead>Pickup Time</TableHead>
                  <TableHead>Delivery Time</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLoads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <div className="text-muted-foreground" data-testid="empty-state">
                        {searchTerm || statusFilter !== "all"
                          ? "No loads found matching your filters"
                          : "No loads yet. Add your first load to get started."}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLoads.map((load) => (
                    <TableRow key={load.id} data-testid={`row-load-${load.id}`}>
                      <TableCell className="font-medium" data-testid={`text-load-number-${load.id}`}>
                        {load.loadNumber}
                      </TableCell>
                      <TableCell data-testid={`text-pickup-${load.id}`}>
                        {load.pickupLocation}
                      </TableCell>
                      <TableCell data-testid={`text-delivery-${load.id}`}>
                        {load.deliveryLocation}
                      </TableCell>
                      <TableCell data-testid={`text-pickup-time-${load.id}`}>
                        {format(new Date(load.pickupTime), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell data-testid={`text-delivery-time-${load.id}`}>
                        {format(new Date(load.deliveryTime), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell data-testid={`text-weight-${load.id}`}>
                        {load.weight ? `${load.weight} lbs` : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(load.status)}
                          data-testid={`badge-status-${load.id}`}
                        >
                          {formatStatus(load.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(load)}
                            data-testid={`button-edit-${load.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(load)}
                            data-testid={`button-delete-${load.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Load</DialogTitle>
            <DialogDescription>
              Update load information
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) =>
                editLoadMutation.mutate({ id: selectedLoad!.id, data })
              )}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="loadNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Load Number *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="LD-001"
                        data-testid="input-edit-load-number"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="pickupLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pickup Location *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="123 Main St, City, ST 12345"
                        data-testid="input-edit-pickup-location"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="deliveryLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delivery Location *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="456 Oak Ave, City, ST 54321"
                        data-testid="input-edit-delivery-location"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="pickupTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pickup Time *</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        data-testid="input-edit-pickup-time"
                        {...field}
                        value={
                          field.value instanceof Date
                            ? format(field.value, "yyyy-MM-dd'T'HH:mm")
                            : ""
                        }
                        onChange={(e) => field.onChange(new Date(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="deliveryTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delivery Time *</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        data-testid="input-edit-delivery-time"
                        {...field}
                        value={
                          field.value instanceof Date
                            ? format(field.value, "yyyy-MM-dd'T'HH:mm")
                            : ""
                        }
                        onChange={(e) => field.onChange(new Date(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight (lbs)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        data-testid="input-edit-weight"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="picked_up">Picked Up</SelectItem>
                        <SelectItem value="in_transit">In Transit</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="scheduleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Schedule</FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                      value={field.value || "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-schedule">
                          <SelectValue placeholder="Select schedule (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {schedules.map((schedule) => (
                          <SelectItem key={schedule.id} value={schedule.id}>
                            {format(new Date(schedule.scheduledDate), "MMM dd, yyyy")} - {schedule.status}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Load details and notes..."
                        data-testid="input-edit-description"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditDialogOpen(false)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={editLoadMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {editLoadMutation.isPending ? "Updating..." : "Update Load"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Load</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete load{" "}
              <span className="font-semibold">{selectedLoad?.loadNumber}</span>? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedLoad && deleteLoadMutation.mutate(selectedLoad.id)}
              disabled={deleteLoadMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteLoadMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
