import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { baseInsertTruckSchema, type Truck, type InsertTruck } from "@shared/schema";
import { Plus, Pencil, Trash2, Search, Truck as TruckIcon } from "lucide-react";
import { format } from "date-fns";
import { z } from "zod";

const formSchema = baseInsertTruckSchema.extend({
  lastInspection: z.string().optional(),
  nextInspection: z.string().optional(),
});

type TruckFormData = z.infer<typeof formSchema>;

export default function Trucks() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);

  const { data: trucks = [], isLoading } = useQuery<Truck[]>({
    queryKey: ["/api/trucks"],
  });

  const addForm = useForm<TruckFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      truckNumber: "",
      make: "",
      model: "",
      year: new Date().getFullYear(),
      vin: "",
      licensePlate: "",
      status: "available",
      lastInspection: "",
      nextInspection: "",
    },
  });

  const editForm = useForm<TruckFormData>({
    resolver: zodResolver(formSchema),
  });

  const addTruckMutation = useMutation({
    mutationFn: async (data: TruckFormData) => {
      const cleanedData: InsertTruck = {
        ...data,
        lastInspection: data.lastInspection ? new Date(data.lastInspection) : undefined,
        nextInspection: data.nextInspection ? new Date(data.nextInspection) : undefined,
      };
      const response = await apiRequest("POST", "/api/trucks", cleanedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setAddDialogOpen(false);
      addForm.reset();
      toast({
        title: "Success",
        description: "Truck added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add truck",
      });
    },
  });

  const editTruckMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TruckFormData }) => {
      const cleanedData: Partial<InsertTruck> = {
        ...data,
        lastInspection: data.lastInspection ? new Date(data.lastInspection) : undefined,
        nextInspection: data.nextInspection ? new Date(data.nextInspection) : undefined,
      };
      const response = await apiRequest("PATCH", `/api/trucks/${id}`, cleanedData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setEditDialogOpen(false);
      setSelectedTruck(null);
      toast({
        title: "Success",
        description: "Truck updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update truck",
      });
    },
  });

  const deleteTruckMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/trucks/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trucks"] });
      setDeleteDialogOpen(false);
      setSelectedTruck(null);
      toast({
        title: "Success",
        description: "Truck deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete truck",
      });
    },
  });

  const filteredTrucks = trucks.filter((truck) => {
    const matchesSearch =
      truck.truckNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      truck.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
      truck.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      truck.vin.toLowerCase().includes(searchTerm.toLowerCase()) ||
      truck.licensePlate.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || truck.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleEdit = (truck: Truck) => {
    setSelectedTruck(truck);
    editForm.reset({
      truckNumber: truck.truckNumber,
      make: truck.make,
      model: truck.model,
      year: truck.year,
      vin: truck.vin,
      licensePlate: truck.licensePlate,
      status: truck.status,
      lastInspection: truck.lastInspection
        ? format(new Date(truck.lastInspection), "yyyy-MM-dd")
        : "",
      nextInspection: truck.nextInspection
        ? format(new Date(truck.nextInspection), "yyyy-MM-dd")
        : "",
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (truck: Truck) => {
    setSelectedTruck(truck);
    setDeleteDialogOpen(true);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "available":
        return "default";
      case "in_use":
        return "secondary";
      case "maintenance":
        return "outline";
      case "retired":
        return "destructive";
      default:
        return "default";
    }
  };

  const formatStatus = (status: string) => {
    return status.split("_").map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(" ");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading trucks...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <TruckIcon className="w-5 h-5 text-primary" data-testid="trucks-icon" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
              Trucks
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
              Manage your fleet vehicles
            </p>
          </div>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-truck">
              <Plus className="w-4 h-4 mr-2" />
              Add Truck
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Truck</DialogTitle>
              <DialogDescription>
                Add a new truck to your fleet
              </DialogDescription>
            </DialogHeader>
            <Form {...addForm}>
              <form
                onSubmit={addForm.handleSubmit((data) => addTruckMutation.mutate(data))}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={addForm.control}
                    name="truckNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Truck Number *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="T-001"
                            data-testid="input-truck-number"
                            {...field}
                          />
                        </FormControl>
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
                            <SelectItem value="available">Available</SelectItem>
                            <SelectItem value="in_use">In Use</SelectItem>
                            <SelectItem value="maintenance">Maintenance</SelectItem>
                            <SelectItem value="retired">Retired</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={addForm.control}
                    name="make"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Make *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Freightliner"
                            data-testid="input-make"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addForm.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Model *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Cascadia"
                            data-testid="input-model"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addForm.control}
                    name="year"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Year *</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="2024"
                            data-testid="input-year"
                            {...field}
                            value={field.value || ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value === "" ? "" : parseInt(value, 10));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={addForm.control}
                    name="vin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>VIN *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="1FUJGHDV8ELXXXXXX"
                            data-testid="input-vin"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addForm.control}
                    name="licensePlate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Plate *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="ABC-1234"
                            data-testid="input-license-plate"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={addForm.control}
                    name="lastInspection"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Inspection</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="input-last-inspection"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={addForm.control}
                    name="nextInspection"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Next Inspection</FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            data-testid="input-next-inspection"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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
                    disabled={addTruckMutation.isPending}
                    data-testid="button-submit-add"
                  >
                    {addTruckMutation.isPending ? "Adding..." : "Add Truck"}
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
                placeholder="Search by truck number, make, model, VIN, or plate..."
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
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="in_use">In Use</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground" data-testid="text-count">
            {filteredTrucks.length} {filteredTrucks.length === 1 ? "truck" : "trucks"}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Truck Number</TableHead>
                  <TableHead>Make/Model</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>License Plate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next Inspection</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrucks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <div className="text-muted-foreground" data-testid="empty-state">
                        {searchTerm || statusFilter !== "all"
                          ? "No trucks found matching your filters"
                          : "No trucks yet. Add your first truck to get started."}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTrucks.map((truck) => (
                    <TableRow key={truck.id} data-testid={`row-truck-${truck.id}`}>
                      <TableCell className="font-medium" data-testid={`text-truck-number-${truck.id}`}>
                        {truck.truckNumber}
                      </TableCell>
                      <TableCell data-testid={`text-make-model-${truck.id}`}>
                        {truck.make} {truck.model}
                      </TableCell>
                      <TableCell data-testid={`text-year-${truck.id}`}>
                        {truck.year}
                      </TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`text-vin-${truck.id}`}>
                        {truck.vin}
                      </TableCell>
                      <TableCell data-testid={`text-license-plate-${truck.id}`}>
                        {truck.licensePlate}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusBadgeVariant(truck.status)}
                          data-testid={`badge-status-${truck.id}`}
                        >
                          {formatStatus(truck.status)}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-next-inspection-${truck.id}`}>
                        {truck.nextInspection
                          ? format(new Date(truck.nextInspection), "MMM dd, yyyy")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(truck)}
                            data-testid={`button-edit-${truck.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(truck)}
                            data-testid={`button-delete-${truck.id}`}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Truck</DialogTitle>
            <DialogDescription>
              Update truck information
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) =>
                editTruckMutation.mutate({ id: selectedTruck!.id, data })
              )}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="truckNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Truck Number *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="T-001"
                          data-testid="input-edit-truck-number"
                          {...field}
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
                          <SelectItem value="available">Available</SelectItem>
                          <SelectItem value="in_use">In Use</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                          <SelectItem value="retired">Retired</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={editForm.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Freightliner"
                          data-testid="input-edit-make"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Cascadia"
                          data-testid="input-edit-model"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="2024"
                          data-testid="input-edit-year"
                          {...field}
                          value={field.value || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === "" ? "" : parseInt(value, 10));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="vin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIN *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="1FUJGHDV8ELXXXXXX"
                          data-testid="input-edit-vin"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="licensePlate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>License Plate *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="ABC-1234"
                          data-testid="input-edit-license-plate"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="lastInspection"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Inspection</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          data-testid="input-edit-last-inspection"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editForm.control}
                  name="nextInspection"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Next Inspection</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          data-testid="input-edit-next-inspection"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                  disabled={editTruckMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {editTruckMutation.isPending ? "Updating..." : "Update Truck"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Truck</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete truck{" "}
              <span className="font-semibold">{selectedTruck?.truckNumber}</span>? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedTruck && deleteTruckMutation.mutate(selectedTruck.id)}
              disabled={deleteTruckMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteTruckMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
