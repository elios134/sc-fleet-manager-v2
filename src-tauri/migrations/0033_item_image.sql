-- Image d'objet (SC Wiki images[0]) pour les vignettes du catalogue. Nullable :
-- beaucoup d'objets fonctionnels n'ont pas d'image côté Wiki (repli icône côté UI).
ALTER TABLE Item ADD COLUMN imageUrl TEXT;
