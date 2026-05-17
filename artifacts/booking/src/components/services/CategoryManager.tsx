import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServiceCategories, useCreateCategory, useUpdateCategory, useDeleteCategory, useReorderServiceCategories } from "@/hooks/use-addons";
import { useSelectedStore } from "@/hooks/use-store";
import { Plus, Pencil, Save, X, Trash2, Camera, Upload, Search, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function CategoryManager() {
  const { data: categories = [] } = useServiceCategories();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryImageUrl, setNewCategoryImageUrl] = useState<string | null>(null);
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { mutate: createCategory, isPending: isCreating } = useCreateCategory();
  const { mutate: updateCategory } = useUpdateCategory();
  const { mutate: deleteCategory } = useDeleteCategory();
  const reorderCategories = useReorderServiceCategories();
  const { selectedStore } = useSelectedStore();
  const { toast } = useToast();

  const [categoryOrder, setCategoryOrder] = useState<string[] | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Load/save category order from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("categoryOrder");
    if (stored) setCategoryOrder(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (categoryOrder) {
      localStorage.setItem("categoryOrder", JSON.stringify(categoryOrder));
      // Persist to backend if we have category IDs
      if (categories && categories.length > 0) {
        // Map names to IDs
        const nameToId: Record<string, number> = {};
        categories.forEach((c: any) => { nameToId[c.name] = c.id; });
        const orderedIds = categoryOrder.map((name) => nameToId[name]).filter(Boolean);
        // Add any categories not in the order list to the end
        const orderedNames = new Set(categoryOrder);
        const remainingIds = categories
          .filter((c: any) => !orderedNames.has(c.name))
          .map((c: any) => c.id);
        
        const finalOrderedIds = [...orderedIds, ...remainingIds];
        
        if (finalOrderedIds.length > 0) {
          reorderCategories.mutate(finalOrderedIds);
        }
      }
    }
  }, [categoryOrder, categories]); // Added categories to dependency array to ensure sync

  const handleDragStart = (idx: number) => { dragItem.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) return;
    
    // Create a complete list of categories based on current sort order
    const currentList = [...categories];
    
    // Sort based on categoryOrder if it exists
    if (categoryOrder) {
      currentList.sort((a: any, b: any) => {
        const idxA = categoryOrder.indexOf(a.name);
        const idxB = categoryOrder.indexOf(b.name);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }

    const newList = [...currentList];
    const [removed] = newList.splice(dragItem.current, 1);
    newList.splice(dragOverItem.current, 0, removed);
    
    setCategoryOrder(newList.map((c: any) => c.name));
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const startEdit = (cat: any) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditImageUrl(cat.imageUrl || null);
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    updateCategory({ id: editingId, name: editName.trim(), imageUrl: editImageUrl || undefined }, {
      onSuccess: () => {
        toast({ title: "Category updated" });
        setEditingId(null);
        setEditName("");
        setEditImageUrl(null);
      },
      onError: () => toast({ title: "Failed to update", variant: "destructive" })
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this category? Services in this category will keep their current category text.")) {
      deleteCategory(id, {
        onSuccess: () => toast({ title: "Category deleted" }),
        onError: () => toast({ title: "Failed to delete", variant: "destructive" })
      });
    }
  };

  const handleCreate = () => {
    if (!newCategoryName.trim()) return;
    createCategory({ name: newCategoryName.trim(), imageUrl: newCategoryImageUrl || undefined }, {
      onSuccess: () => {
        toast({ title: "Category created" });
        setNewCategoryName("");
        setNewCategoryImageUrl(null);
      },
      onError: () => toast({ title: "Failed to create", variant: "destructive" })
    });
  };

  const filteredCategories = categories
    .filter((cat: any) => cat.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a: any, b: any) => {
      if (!categoryOrder) return 0;
      const idxA = categoryOrder.indexOf(a.name);
      const idxB = categoryOrder.indexOf(b.name);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new window.FileReader();
    reader.onloadend = () => {
      if (isEdit) {
        setEditImageUrl(reader.result as string);
      } else {
        setNewCategoryImageUrl(reader.result as string);
      }
    };
    reader.onerror = () => {
      toast({ title: "Failed to read image", variant: "destructive" });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Service Categories</h2>
          <p className="text-muted-foreground">Manage categories to organize your services.</p>
        </div>
        <div className="flex items-center gap-2">
          {newCategoryImageUrl && (
            <img src={newCategoryImageUrl} alt="New" className="w-9 h-9 rounded object-cover border" />
          )}
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id="new-cat-image"
              onChange={(e) => handleFileChange(e, false)}
            />
            <label
              htmlFor="new-cat-image"
              className="flex items-center justify-center w-9 h-9 border rounded cursor-pointer hover:bg-muted"
              title="Upload Image"
            >
              <Camera className="w-4 h-4 text-muted-foreground" />
            </label>
          </div>
          <Input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name..."
            className="w-[200px]"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            data-testid="input-new-category"
          />
          <Button
            onClick={handleCreate}
            disabled={isCreating || !newCategoryName.trim() || !selectedStore}
            data-testid="button-create-category"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Category
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <div className="p-4 border-b flex justify-between items-center bg-muted/50">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search categories..."
              className="pl-9 bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="ml-4 text-xs text-muted-foreground">
            Drag row handle to reorder
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead className="w-[100px]">Image</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCategories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="p-6 text-center text-muted-foreground">No categories found.</TableCell>
              </TableRow>
            ) : (
              filteredCategories.map((cat: any, idx: number) => (
                <TableRow
                  key={cat.id}
                  className="group"
                  data-testid={`category-item-${cat.id}`}
                  draggable={!searchQuery && !editingId}
                  onDragStart={() => !searchQuery && !editingId && handleDragStart(idx)}
                  onDragEnter={() => !searchQuery && !editingId && handleDragEnter(idx)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                > 
                  <TableCell className="cursor-move text-muted-foreground">
                      {!searchQuery && !editingId && <GripVertical className="w-4 h-4" />}
                  </TableCell>
                  {editingId === cat.id ? (
                    <>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {editImageUrl && (
                            <img src={editImageUrl} alt="Edit" className="w-9 h-9 border rounded object-cover" />
                          )}
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              id={`edit-cat-image-${cat.id}`}
                              onChange={(e) => handleFileChange(e, true)}
                            />
                            <label
                              htmlFor={`edit-cat-image-${cat.id}`}
                              className="flex items-center justify-center w-8 h-8 border rounded cursor-pointer hover:bg-muted"
                              title="Change Image"
                            >
                              <Camera className="w-4 h-4 text-muted-foreground" />
                            </label>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-9"
                          onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                          autoFocus
                          data-testid={`input-edit-category-${cat.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={saveEdit} data-testid={`button-save-category-${cat.id}`}>
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} data-testid={`button-cancel-category-${cat.id}`}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>
                        {cat.imageUrl && (
                          <img src={cat.imageUrl} alt={cat.name} className="w-10 h-10 border rounded object-cover" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-category-name-${cat.id}`}>{cat.name}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => startEdit(cat)} data-testid={`button-edit-category-${cat.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleDelete(cat.id)} data-testid={`button-delete-category-${cat.id}`} className="text-destructive hover:text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
