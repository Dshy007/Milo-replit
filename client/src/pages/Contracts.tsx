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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertContractSchema, type Contract, type InsertContract } from "@shared/schema";
import { Plus, Pencil, Trash2, Search, FileText } from "lucide-react";

export default function Contracts() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const addForm = useForm<InsertContract>({
    resolver: zodResolver(insertContractSchema.omit({ tenantId: true })),
    defaultValues: {
      name: "",
      type: "solo1",
      baseRoutes: 10,
      daysPerWeek: 6,
      protectedDrivers: false,
    },
  });

  const editForm = useForm<InsertContract>({
    resolver: zodResolver(insertContractSchema.omit({ tenantId: true })),
  });

  const addContractMutation = useMutation({
    mutationFn: async (data: InsertContract) => {
      const response = await apiRequest("POST", "/api/contracts", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setAddDialogOpen(false);
      addForm.reset();
      toast({
        title: "Success",
        description: "Contract added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to add contract",
      });
    },
  });

  const editContractMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertContract> }) => {
      const response = await apiRequest("PATCH", `/api/contracts/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setEditDialogOpen(false);
      setSelectedContract(null);
      toast({
        title: "Success",
        description: "Contract updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update contract",
      });
    },
  });

  const deleteContractMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/contracts/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setDeleteDialogOpen(false);
      setSelectedContract(null);
      toast({
        title: "Success",
        description: "Contract deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete contract",
      });
    },
  });

  const filteredContracts = contracts.filter((contract) => {
    const matchesSearch =
      contract.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || contract.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const handleEdit = (contract: Contract) => {
    setSelectedContract(contract);
    editForm.reset({
      name: contract.name,
      type: contract.type,
      baseRoutes: contract.baseRoutes,
      daysPerWeek: contract.daysPerWeek,
      protectedDrivers: contract.protectedDrivers,
    });
    setEditDialogOpen(true);
  };

  const handleDelete = (contract: Contract) => {
    setSelectedContract(contract);
    setDeleteDialogOpen(true);
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "solo1":
        return "default";
      case "solo2":
        return "secondary";
      case "team":
        return "outline";
      default:
        return "default";
    }
  };

  const formatType = (type: string) => {
    switch (type) {
      case "solo1":
        return "Solo 1";
      case "solo2":
        return "Solo 2";
      case "team":
        return "Team";
      default:
        return type;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading contracts...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background p-6 gap-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <FileText className="w-5 h-5 text-primary" data-testid="contracts-icon" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="page-title">
              Contracts
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="page-subtitle">
              Manage contract types and routes
            </p>
          </div>
        </div>

        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-contract">
              <Plus className="w-4 h-4 mr-2" />
              Add Contract
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Contract</DialogTitle>
              <DialogDescription>
                Create a new contract type
              </DialogDescription>
            </DialogHeader>
            <Form {...addForm}>
              <form
                onSubmit={addForm.handleSubmit((data) => addContractMutation.mutate(data))}
                className="space-y-4"
              >
                <FormField
                  control={addForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Name *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Solo1"
                          data-testid="input-name"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        e.g., Solo1, Solo2, Team
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="solo1">Solo 1</SelectItem>
                          <SelectItem value="solo2">Solo 2</SelectItem>
                          <SelectItem value="team">Team</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="baseRoutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Base Routes *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="10"
                          data-testid="input-base-routes"
                          {...field}
                          value={field.value || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === "" ? "" : parseInt(value, 10));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Number of base routes (e.g., 10 for Solo1, 7 for Solo2)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="daysPerWeek"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Days Per Week *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="6"
                          data-testid="input-days-per-week"
                          {...field}
                          value={field.value || ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === "" ? "" : parseInt(value, 10));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Rolling pattern days per week (default: 6)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={addForm.control}
                  name="protectedDrivers"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Protected Drivers
                        </FormLabel>
                        <FormDescription>
                          Enable driver protection for this contract
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-protected-drivers"
                        />
                      </FormControl>
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
                    disabled={addContractMutation.isPending}
                    data-testid="button-submit-add"
                  >
                    {addContractMutation.isPending ? "Adding..." : "Add Contract"}
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
                placeholder="Search by contract name or type..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter-type">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="solo1">Solo 1</SelectItem>
                <SelectItem value="solo2">Solo 2</SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground" data-testid="text-count">
            {filteredContracts.length} {filteredContracts.length === 1 ? "contract" : "contracts"}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Base Routes</TableHead>
                  <TableHead>Days/Week</TableHead>
                  <TableHead>Protected Drivers</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContracts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <div className="text-muted-foreground" data-testid="empty-state">
                        {searchTerm || typeFilter !== "all"
                          ? "No contracts found matching your filters"
                          : "No contracts yet. Add your first contract to get started."}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredContracts.map((contract) => (
                    <TableRow key={contract.id} data-testid={`row-contract-${contract.id}`}>
                      <TableCell className="font-medium" data-testid={`text-name-${contract.id}`}>
                        {contract.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getTypeBadgeVariant(contract.type)}
                          data-testid={`badge-type-${contract.id}`}
                        >
                          {formatType(contract.type)}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-base-routes-${contract.id}`}>
                        {contract.baseRoutes}
                      </TableCell>
                      <TableCell data-testid={`text-days-per-week-${contract.id}`}>
                        {contract.daysPerWeek}
                      </TableCell>
                      <TableCell data-testid={`text-protected-${contract.id}`}>
                        {contract.protectedDrivers ? (
                          <Badge variant="default">Yes</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(contract)}
                            data-testid={`button-edit-${contract.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(contract)}
                            data-testid={`button-delete-${contract.id}`}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Contract</DialogTitle>
            <DialogDescription>
              Update contract information
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((data) =>
                editContractMutation.mutate({ id: selectedContract!.id, data })
              )}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract Name *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Solo1"
                        data-testid="input-edit-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contract Type *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="solo1">Solo 1</SelectItem>
                        <SelectItem value="solo2">Solo 2</SelectItem>
                        <SelectItem value="team">Team</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editForm.control}
                name="baseRoutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Base Routes *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="10"
                        data-testid="input-edit-base-routes"
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

              <FormField
                control={editForm.control}
                name="daysPerWeek"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Days Per Week *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="6"
                        data-testid="input-edit-days-per-week"
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

              <FormField
                control={editForm.control}
                name="protectedDrivers"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        Protected Drivers
                      </FormLabel>
                      <FormDescription>
                        Enable driver protection for this contract
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-edit-protected-drivers"
                      />
                    </FormControl>
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
                  disabled={editContractMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {editContractMutation.isPending ? "Updating..." : "Update Contract"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contract</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete contract{" "}
              <span className="font-semibold">{selectedContract?.name}</span>? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedContract && deleteContractMutation.mutate(selectedContract.id)}
              disabled={deleteContractMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteContractMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
