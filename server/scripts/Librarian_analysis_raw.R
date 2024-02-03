
## This is a minimal analysis script for Librarian. It avoids graphical output and only produces the txt file required
## to render the heatmap in MultiQC

## This script reads in a pinned umap model of a collection of library compositions.
## Compositions from test libraries get projected onto the existing UMAP.


## Loading packages

library(pins)
library(umap)
library(tidyverse)
library(ggrastr)


## Getting input file path

args = commandArgs(trailingOnly=TRUE)


## creating the pin board

board <- board_folder(args[2])

## loading the pinned model and coordinates

board %>% 
  pin_read("compositions_umap") -> compositions_umap

board %>% 
  pin_read("compositions_umap_results") -> compositions_umap_results


## Loading gathered library compositions

read_tsv(file("stdin"), col_names = FALSE) -> test.import



## header for the handling of the test library

header <- as.character(expression(sample, sample_name, A1, C1, G1, T1, N1, A2, C2, G2, T2, N2, A3, C3, G3, T3, N3, A4, C4, G4, T4, N4, A5, C5, G5, T5, N5, A6, C6, G6, T6, N6, A7, C7, G7, T7, N7, A8, C8, G8, T8, N8, A9, C9, G9, T9, N9, A10, C10, G10, T10, N10, A11, C11, G11, T11, N11, A12, C12, G12, T12, N12, A13, C13, G13, T13, N13, A14, C14, G14, T14, N14, A15, C15, G15, T15, N15, A16, C16, G16, T16, N16, A17, C17, G17, T17, N17, A18, C18, G18, T18, N18, A19, C19, G19, T19, N19, A20, C20, G20, T20, N20, A21, C21, G21, T21, N21, A22, C22, G22, T22, N22, A23, C23, G23, T23, N23, A24, C24, G24, T24, N24, A25, C25, G25, T25, N25, A26, C26, G26, T26, N26, A27, C27, G27, T27, N27, A28, C28, G28, T28, N28, A29, C29, G29, T29, N29, A30, C30, G30, T30, N30, A31, C31, G31, T31, N31, A32, C32, G32, T32, N32, A33, C33, G33, T33, N33, A34, C34, G34, T34, N34, A35, C35, G35, T35, N35, A36, C36, G36, T36, N36, A37, C37, G37, T37, N37, A38, C38, G38, T38, N38, A39, C39, G39, T39, N39, A40, C40, G40, T40, N40, A41, C41, G41, T41, N41, A42, C42, G42, T42, N42, A43, C43, G43, T43, N43, A44, C44, G44, T44, N44, A45, C45, G45, T45, N45, A46, C46, G46, T46, N46, A47, C47, G47, T47, N47, A48, C48, G48, T48, N48, A49, C49, G49, T49, N49, A50, C50, G50, T50, N50
))

## Some tidying

colnames(test.import) <- header

test.import %>% 
  drop_na() %>%  # get rid of the ones that don't have compositions
  mutate(Nsum = rowSums(select(.,starts_with("N")))) %>% 
  filter(Nsum < 301) %>% # should give a warning here instead
  drop_na() %>% 
  select(-starts_with("N"), -Nsum) -> test # disregarding Ns

## Making sample name lookup

test %>% 
  select(sample, sample_name) -> sample_lookup


## Arranging test data for umap

test %>% 
  select(-sample_name) %>% 
  column_to_rownames(var = "sample")%>% 
  as.data.frame() -> test.data


## setting global seed which should be used by umap and the predict functions

set.seed(111)


## Projecting test library

predict(compositions_umap, test.data) -> test_umap


## Preparing for plotting

test_umap %>% 
  as.data.frame() %>% 
  rownames_to_column() %>% 
  as_tibble() %>% 
  rename(sample = rowname, UMAP1 = V1, UMAP2 = V2) -> test_coordinates


## Introducing a grid to the plot

compositions_umap_results %>% 
  mutate(lib_type = if_else(lib_type == "ATAC-seq", "ATAC-Seq", lib_type)) %>% 
  mutate(UMAP1_grid = round(UMAP1)) %>% 
  mutate(UMAP2_grid = round(UMAP2)) %>% 
  unite(col = "grid_ID", UMAP1_grid, UMAP2_grid, remove = F) %>% 
  group_by(grid_ID) %>% 
  add_count(name = "n per raster point") %>% 
  ungroup() %>% 
  group_by(lib_type) %>% 
  add_count(name = "n per lib_type") %>% 
  ungroup() -> umap_grid


## Calculating the percentages of the library type that is located in each grid tile
## total is number of library type examples

umap_grid %>% 
  group_by(grid_ID, lib_type) %>% 
  count() %>% 
  ungroup() %>% 
  pivot_wider(names_from = lib_type, values_from = n, values_fill = 0) %>% 
  mutate_at(vars(2:10), ~. / sum(.)*100) -> grid_type_percentages


## Calculating the percentages of each library type located in each grid tile
## Correcting for the number of examples in each library type (total is 100%)

grid_type_percentages %>% 
  pivot_longer(2:last_col(), names_to = "lib_type") %>% 
  group_by(grid_ID) %>% 
  mutate(tile_total = sum(value)) %>% 
  mutate(corr_lib_per_tile = value/tile_total*100) %>% 
  select(grid_ID, lib_type, corr_lib_per_tile) %>% 
  ungroup() %>% 
  pivot_wider(names_from = "lib_type", values_from = "corr_lib_per_tile") -> grid_tile_corr_percentages


## Joining with the other umap plotting information

umap_grid %>% 
  select(-`n per raster point`, -`n per lib_type`) %>% 
  left_join(grid_tile_corr_percentages) -> umap_grid_corr_tile # percentage of each library per tile


## Pulling out probabilities for the test library

test_coordinates %>% 
  mutate(UMAP1_grid = round(UMAP1)) %>% 
  mutate(UMAP2_grid = round(UMAP2)) %>% 
  unite(col = "grid_ID", UMAP1_grid, UMAP2_grid) -> test_grid

test_grid %>% 
  left_join(grid_tile_corr_percentages) %>% 
  pivot_longer(5:last_col(), names_to = "library_type", values_to = "percent") -> test_percentage


## Exporting probablility table for use in MultiQC

test_percentage %>% 
  left_join(sample_lookup) %>% 
  select(sample_name, library_type, percent) %>% 
  pivot_wider(names_from = library_type, values_from = percent) -> probabilities_wide

write_tsv(probabilities_wide, file = file.path(args[3], "librarian_heatmap.txt"))


