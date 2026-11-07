package ukubikit

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"maps"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestManifest(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if m.Ages() < 2 {
		t.Fatalf("%d ages", m.Ages())
	}
	for id, md := range m.Models {
		b, err := fs.ReadFile(FS(), md.File)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != md.SHA256 || len(b) != md.Bytes {
			t.Errorf("%s: %s is not the manifest's", id, md.File)
		}
		if _, ok := m.Kits[md.Kit]; !ok {
			t.Errorf("%s: kit %s has no licence entry", id, md.Kit)
		}
	}
	if m.Clips == nil || len(m.Characters) == 0 {
		t.Fatal("no characters or no clips")
	}
	for id, c := range m.Characters {
		b, err := fs.ReadFile(FS(), c.File)
		if err != nil {
			t.Errorf("character %s: %v", id, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != c.SHA256 || len(b) != c.Bytes {
			t.Errorf("character %s: %s is not the manifest's", id, c.File)
		}
		if _, err := fs.Stat(FS(), c.Texture); err != nil || !m.Kits[c.Kit].People || c.Height <= 0 {
			t.Errorf("character %s: texture %v, kit %+v, height %v", id, err, m.Kits[c.Kit], c.Height)
		}
	}
	if b, err := fs.ReadFile(FS(), m.Clips.File); err != nil || len(b) != m.Clips.Bytes || !slices.Contains(m.Clips.Names, "Interact") {
		t.Errorf("clips %+v: %v", m.Clips, err)
	}
	// the world's avatar and what it plays: the knight, on the clips' rig (the build refuses a character off it), and
	// the clips the game names
	if k, ok := m.Characters["knight"]; !ok || k.Kit != m.Clips.Kit || m.Clips.Joints != 41 {
		t.Errorf("knight %+v on clips %+v", k, m.Clips)
	}
	// the game's four classes, each a character on the clips' kit
	for _, id := range []string{"knight", "mage", "barbarian", "rogue"} {
		if c, ok := m.Characters[id]; !ok || c.Kit != m.Clips.Kit {
			t.Errorf("class %s: %+v", id, c)
		}
	}
	// both clip files' names, in order (the game may index them), on the one rig
	want := map[string][]string{
		"clips": {"Idle", "Walking_A", "Interact", "Running_A", "Sit_Chair_Idle"},
		"fight": {"1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Diagonal", "Spellcast_Shoot", "1H_Ranged_Shoot", "Hit_A", "Death_A", "Jump_Start", "Jump_Idle", "Jump_Land", "Block",
			"1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Stab", "Blocking", "Block_Attack", "Block_Hit", "Cheer",
			"Spellcast_Long", "Spellcast_Raise", "Spellcasting",
			"2H_Melee_Attack_Chop", "2H_Melee_Attack_Slice", "2H_Melee_Attack_Stab", "2H_Melee_Attack_Spin", "2H_Melee_Attack_Spinning", "2H_Melee_Idle",
			"Dodge_Forward", "Dodge_Backward", "Dodge_Left", "Dodge_Right", "Throw",
			"Dualwield_Melee_Attack_Chop", "Dualwield_Melee_Attack_Slice", "Dualwield_Melee_Attack_Stab",
			"1H_Ranged_Aiming", "1H_Ranged_Reload", "1H_Ranged_Shooting", "2H_Ranged_Aiming", "2H_Ranged_Shoot", "2H_Ranged_Shooting", "2H_Ranged_Reload",
			"Jump_Full_Long"},
	}
	for key, c := range map[string]*Clips{"clips": m.Clips, "fight": m.Fight} {
		if c == nil {
			t.Errorf("no %s", key)
			continue
		}
		if !slices.Equal(c.Names, want[key]) || c.Joints != 41 || c.Kit != m.Clips.Kit {
			t.Errorf("%s: %v on %d joints, kit %s; want %v on 41, kit %s", key, c.Names, c.Joints, c.Kit, want[key], m.Clips.Kit)
		}
		b, err := fs.ReadFile(FS(), c.File)
		if err != nil {
			t.Errorf("%s: %v", key, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != c.SHA256 || len(b) != c.Bytes {
			t.Errorf("%s: %s is not the manifest's", key, c.File)
		}
	}
	// the weapons: each its file, by hash, its texture, held on a hand slot
	for _, name := range []string{"sword_1handed", "staff", "wand", "crossbow_1handed", "sword_2handed", "sword_offhand",
		"shield_badge", "shield_rectangle", "shield_round", "shield_spike", "axe_1handed", "axe_offhand", "axe_2handed",
		"shield_barbarian", "spellbook", "spellbook_open", "crossbow_2handed", "knife", "knife_offhand", "throwable"} {
		w, ok := m.Weapons[name]
		if !ok {
			t.Errorf("no weapon %s", name)
			continue
		}
		b, err := fs.ReadFile(FS(), w.File)
		if err != nil {
			t.Errorf("weapon %s: %v", name, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != w.SHA256 || len(b) != w.Bytes {
			t.Errorf("weapon %s: %s is not the manifest's", name, w.File)
		}
		if _, err := fs.Stat(FS(), w.Texture); err != nil || !m.Kits[w.Kit].People || w.Tris <= 0 || w.Size[1] <= 0 {
			t.Errorf("weapon %s: texture %v, kit %+v, %d triangles, size %v", name, err, m.Kits[w.Kit], w.Tris, w.Size)
		}
		if w.Slot != "handslot.r" && w.Slot != "handslot.l" {
			t.Errorf("weapon %s: on %q, not a hand slot", name, w.Slot)
		}
	}
	// the classes' bare bodies (no hat, no cape: the look wears parts) share their character's texture and rig, and are
	// lighter than it by the hat and cape
	for _, id := range []string{"knight", "mage", "barbarian", "rogue"} {
		c, bare := m.Characters[id], m.Characters[id+"_bare"]
		b, err := fs.ReadFile(FS(), bare.File)
		if err != nil {
			t.Errorf("%s_bare: %v", id, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != bare.SHA256 || len(b) != bare.Bytes {
			t.Errorf("%s_bare: %s is not the manifest's", id, bare.File)
		}
		if bare.Texture != c.Texture || bare.Kit != c.Kit || bare.Tris <= 0 || bare.Tris >= c.Tris {
			t.Errorf("%s_bare: %+v against %+v", id, bare, c)
		}
	}
	// the hats and capes: weapons built on the head or chest bone, each painted by its own class's texture
	slots := map[string]string{"hat_knight": "head", "hat_mage": "head", "hat_barbarian": "head",
		"cape_knight": "chest", "cape_mage": "chest", "cape_barbarian": "chest", "cape_rogue": "chest"}
	if len(m.Parts) != len(slots) {
		t.Errorf("%d parts, want %d", len(m.Parts), len(slots))
	}
	for id, slot := range slots {
		p, ok := m.Parts[id]
		if !ok {
			t.Errorf("no part %s", id)
			continue
		}
		b, err := fs.ReadFile(FS(), p.File)
		if err != nil {
			t.Errorf("part %s: %v", id, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != p.SHA256 || len(b) != p.Bytes {
			t.Errorf("part %s: %s is not the manifest's", id, p.File)
		}
		class := id[strings.Index(id, "_")+1:]
		if p.Slot != slot || p.Texture != m.Characters[class].Texture || p.Tris <= 0 || p.Size[1] <= 0 || !m.Kits[p.Kit].People {
			t.Errorf("part %s: %+v on %q, want slot %s, texture %s", id, p, p.Slot, slot, m.Characters[class].Texture)
		}
	}
	// the tint slots, hand-written from the textures: the measured head cells (the face, hair and eyes) are never a slot's
	// (the build checks it too), the slots share no cell, and every cell is on the grid
	head := map[string][][2]int{
		"knight":    {{0, 0}, {1, 0}, {2, 0}},
		"mage":      {{0, 0}, {1, 0}, {1, 1}, {2, 0}},
		"barbarian": {{0, 0}, {1, 0}, {2, 0}},
		"rogue":     {{0, 0}, {1, 0}, {2, 0}, {3, 0}},
	}
	if len(m.Cells) != len(head) {
		t.Errorf("cells for %d classes, want %d", len(m.Cells), len(head))
	}
	for id, heads := range head {
		c, seen := m.Cells[id], map[[2]int]bool{}
		if len(c.Cloth) == 0 || len(c.Trim) == 0 {
			t.Errorf("cells %s: %+v", id, c)
		}
		for _, cell := range append(slices.Clone(c.Cloth), c.Trim...) {
			if slices.Contains(heads, cell) || seen[cell] || cell[0] < 0 || cell[0] >= 8 || cell[1] < 0 || cell[1] >= 4 {
				t.Errorf("cells %s: %v is a head cell, twice a slot's or off the 8×4 grid", id, cell)
			}
			seen[cell] = true
		}
	}
	// the world's props: each its file, by hash, its texture, its kit a props kit, within its cap
	caps := map[string]int{"bike": 800, "ship": 1500, "turtle": 3000, "elephant": 1500, "beam": 24}
	for name, limit := range caps {
		p, ok := m.Props[name]
		if !ok {
			t.Errorf("no prop %s", name)
			continue
		}
		b, err := fs.ReadFile(FS(), p.File)
		if err != nil {
			t.Errorf("prop %s: %v", name, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != p.SHA256 || len(b) != p.Bytes {
			t.Errorf("prop %s: %s is not the manifest's", name, p.File)
		}
		if _, err := fs.Stat(FS(), p.Texture); err != nil || !m.Kits[p.Kit].IsProps {
			t.Errorf("prop %s: texture %v, kit %+v", name, err, m.Kits[p.Kit])
		}
		if p.Tris <= 0 || p.Tris > limit || p.Size[0] <= 0 || p.Size[1] <= 0 || p.Size[2] <= 0 {
			t.Errorf("prop %s: %d triangles (cap %d), size %v", name, p.Tris, limit, p.Size)
		}
	}
	if len(m.Props) != len(caps) {
		t.Errorf("%d props, want %d", len(m.Props), len(caps))
	}
	for style, kits := range m.Styles {
		for kit, file := range kits {
			if _, err := fs.Stat(FS(), file); err != nil {
				t.Errorf("style %s/%s: %v", style, kit, err)
			}
		}
	}
	for name, c := range m.Civs {
		if len(c.Styles) != m.Ages() {
			t.Errorf("%s: %d styles, %d ages", name, len(c.Styles), m.Ages())
		}
		if name != Default && c.Roles[Product] == nil {
			t.Errorf("%s: no product", name)
		}
		// one kit per civ: its buildings, its plot and its dressing
		for _, id := range append(slices.Concat(slices.Concat(slices.Collect(maps.Values(c.Roles))...)...), append(c.Dress, c.Plot)...) {
			if id != "" && m.Models[id].Kit != c.Kit {
				t.Errorf("%s draws %s, a %s model, not its own kit's (%s)", name, id, m.Models[id].Kit, c.Kit)
			}
		}
		for _, st := range c.Styles {
			if m.Styles[st]["hexagon"] == "" {
				t.Errorf("%s: style %s does not paint the tiles and construction (hexagon)", name, st)
			}
		}
		for role, ages := range c.Roles {
			for a, vs := range ages {
				for _, id := range vs {
					if md, ok := m.Models[id]; !ok {
						t.Errorf("%s/%s/%d: %s is not a model", name, role, a+1, id)
					} else if m.Styles[c.Styles[a]][md.Kit] == "" {
						t.Errorf("%s/%s/%d: style %s has no %s texture", name, role, a+1, c.Styles[a], md.Kit)
					}
				}
			}
		}
	}
}

// TestCreatures: the wolf, its file by hash, and its clips pinned by name and order, in the manifest and in its own
// GLB (the game may index the list: a new clip goes last).
func TestCreatures(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	w, ok := m.Creatures["wolf"]
	if !ok {
		t.Fatal("no wolf")
	}
	clips := []string{"Idle", "Walk", "Gallop", "Attack", "Idle_HitReact_Left", "Death"}
	if !slices.Equal(w.Clips, clips) || len(w.Durations) != len(clips) {
		t.Errorf("wolf clips %v (%v), want %v", w.Clips, w.Durations, clips)
	}
	if w.SHA256 != "d475011d3aef6c1b69e1619b1ab1904d3e2f89c4d202bc65dff8f091b2b9412e" {
		t.Errorf("wolf: sha256 %s: a changed wolf is reviewed, then pinned here", w.SHA256)
	}
	if !m.Kits[w.Kit].Animals || w.Tris <= 0 || w.Tris > 3000 || w.Height <= 0 {
		t.Errorf("wolf %+v, kit %+v", w, m.Kits[w.Kit])
	}
	for name, c := range m.Creatures {
		b, err := fs.ReadFile(FS(), c.File)
		if err != nil {
			t.Errorf("creature %s: %v", name, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != c.SHA256 || len(b) != c.Bytes {
			t.Errorf("creature %s: %s is not the manifest's", name, c.File)
		}
		var doc struct {
			Animations []struct{ Name string }
			Skins      []json.RawMessage
			Meshes     []struct{ Primitives []json.RawMessage }
		}
		if err := json.Unmarshal(b[20:20+int(binary.LittleEndian.Uint32(b[12:16]))], &doc); err != nil {
			t.Fatalf("creature %s: %v", name, err)
		}
		var names []string
		for _, a := range doc.Animations {
			names = append(names, a.Name)
		}
		if !slices.Equal(names, c.Clips) {
			t.Errorf("creature %s: its file's clips %v, the manifest's %v", name, names, c.Clips)
		}
		if len(doc.Skins) != 1 || len(doc.Meshes) != 1 || len(doc.Meshes[0].Primitives) != 1 {
			t.Errorf("creature %s: %d skins, %d meshes: not one skinned draw", name, len(doc.Skins), len(doc.Meshes))
		}
	}
}

func TestPick(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	a, sa, ok := m.Pick("apps", "product", 2, "x")
	b, _, _ := m.Pick("apps", "product", 2, "x")
	if !ok || a != b || sa != m.Civs["apps"].Styles[1] {
		t.Errorf("apps/product/2 = %s %s %v, then %s: a pick must be stable", a, sa, ok, b)
	}
	if id, s, ok := m.Pick("guard", "houses", 1, "x"); !ok || s != m.Civs["guard"].Styles[0] || !slices.Contains(m.Civs["guard"].Roles[Product][0], id) {
		t.Errorf("a role the civ lacks draws its own product: %s %s %v", id, s, ok)
	}
	if _, s, _ := m.Pick("nowhere", "houses", 1, "x"); s != m.Civs[Default].Styles[0] {
		t.Errorf("an unknown civ is the default civ: %s", s)
	}
	if _, _, ok := m.Pick("nowhere", "houses", 9, "x"); !ok {
		t.Error("an unknown civ and an age past the last fall back")
	}
	if _, _, ok := m.Pick("apps", "nothing", 1, "x"); ok {
		t.Error("a role no civ has is not ok")
	}
	// adding a variant moves only the seeds that pick it
	c := m.Civs["apps"]
	before := map[string]string{}
	for i := range 200 {
		s := strconv.Itoa(i)
		before[s], _, _ = m.Pick("apps", "product", 2, s)
	}
	roles := map[string][][]string{"product": {c.Roles["product"][0], append(slices.Clone(c.Roles["product"][1]), "extra")}}
	m.Civs["apps"] = Civ{Kit: c.Kit, Styles: c.Styles, Roles: roles, Shapes: c.Shapes}
	for s, was := range before {
		if now, _, _ := m.Pick("apps", "product", 2, s); now != was && now != "extra" {
			t.Errorf("seed %s moved from %s to %s, not to the new variant", s, was, now)
		}
	}
	m.Civs["apps"] = c
	seen := map[string]bool{}
	for _, id := range []string{"a", "b", "c", "d", "e", "f", "g", "h"} {
		v, _, _ := m.Pick("apps", "product", 2, id)
		seen[v] = true
	}
	if len(seen) < 2 {
		t.Error("variants never vary")
	}
}

// TestPickFor: a building asking for a shape draws among the variants carrying it, else the untagged ones, else all;
// asking for none never draws a tagged variant while an untagged one exists; and a pick is always made.
func TestPickFor(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	for civ, c := range m.Civs {
		for _, shape := range c.Shapes {
			if !slices.Contains(m.Shapes, shape) {
				t.Errorf("%s: shape %q is not in the vocabulary %v", civ, shape, m.Shapes)
			}
		}
		for role, slots := range c.Roles {
			for age := range slots {
				vs := slots[age]
				untagged := slices.ContainsFunc(vs, func(v string) bool { _, ok := c.Shapes[v]; return !ok })
				for i := range 60 {
					seed := strconv.Itoa(i)
					v, _, ok := m.PickFor(civ, role, age+1, seed, nil)
					if !ok || v == "" {
						t.Fatalf("%s/%s/%d: nothing drawn", civ, role, age+1)
					}
					if _, tagged := c.Shapes[v]; tagged && untagged {
						t.Errorf("%s/%s/%d: asked for nothing, drew tagged %s", civ, role, age+1, v)
					}
					for _, shape := range m.Shapes {
						v, _, _ := m.PickFor(civ, role, age+1, seed, []string{shape})
						has := slices.ContainsFunc(vs, func(x string) bool { return c.Shapes[x] == shape })
						if has && c.Shapes[v] != shape {
							t.Errorf("%s/%s/%d: asked for %s, drew %s", civ, role, age+1, shape, v)
						}
					}
				}
			}
		}
	}
	// what the guard's defence draws for a gate, and that Pick is PickFor asking for nothing
	if v, _, _ := m.PickFor("guard", "defence", 2, "x", []string{"gate"}); v != "recipe/fort-gatehouse" {
		t.Errorf("guard's gate at age 2: %s", v)
	}
	a, _, _ := m.Pick("data", "economy", 1, "y")
	b, _, _ := m.PickFor("data", "economy", 1, "y", nil)
	if a != b {
		t.Errorf("Pick %s, PickFor(nil) %s", a, b)
	}
}

// TestNoEmbeddedImages: no built model carries an image or a texture. The game's pages run under img-src 'self' (no
// blob: or data:), and three.js decodes an embedded image through a blob URL: the kit's textures are files of their
// own (a style's, a character's), never inside a model.
func TestNoEmbeddedImages(t *testing.T) {
	n := 0
	fs.WalkDir(FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".glb") {
			return err
		}
		b, err := fs.ReadFile(FS(), p)
		if err != nil {
			t.Error(err)
			return nil
		}
		// a GLB: a 12-byte header, then the JSON chunk (length, type "JSON", data)
		if len(b) < 20 || string(b[:4]) != "glTF" || string(b[16:20]) != "JSON" {
			t.Errorf("%s: not a GLB with a JSON chunk", p)
			return nil
		}
		l := int(binary.LittleEndian.Uint32(b[12:16]))
		if 20+l > len(b) {
			t.Errorf("%s: a short JSON chunk", p)
			return nil
		}
		var doc map[string]json.RawMessage
		if err := json.Unmarshal(b[20:20+l], &doc); err != nil {
			t.Errorf("%s: %v", p, err)
			return nil
		}
		for _, k := range []string{"images", "textures"} {
			if _, ok := doc[k]; ok {
				t.Errorf("%s holds %s: an embedded image breaks the game's CSP (img-src 'self')", p, k)
			}
		}
		n++
		return nil
	})
	if n == 0 {
		t.Fatal("no model read")
	}
}

// TestTilesAtOrigin: every hex tile keeps its own origin (source.yaml unground), its top at y = 0 or below (water at
// -0.2) and its column
// below, so a tile drops onto the land at its level; a building stands on y = 0 (grounded), its top above it.
func TestTilesAtOrigin(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for id, md := range m.Models {
		if !strings.HasPrefix(id, "hexagon/hex_") {
			continue
		}
		n++
		if y := maxY(t, md.File); y > 0.001 {
			t.Errorf("%s: top at y = %.3f, not 0 (a tile is never grounded)", id, y)
		}
	}
	if n < 34 {
		t.Errorf("%d hex tiles, want at least 34", n)
	}
	if y := maxY(t, m.Models["hexagon/building_home_A_blue"].File); y <= 0 {
		t.Errorf("building_home_A_blue: top at y = %.3f, not above the ground", y)
	}
}

// maxY: a GLB's highest vertex, from its POSITION accessor's max through its one node's scale and translation (the
// build's quantization keeps its dequantization there)
func maxY(t *testing.T, file string) float64 {
	t.Helper()
	b, err := fs.ReadFile(FS(), file)
	if err != nil || len(b) < 20 {
		t.Fatalf("%s: %v", file, err)
	}
	var doc struct {
		Nodes []struct {
			Mesh        int
			Translation []float64
			Scale       []float64
			Rotation    []float64
			Matrix      []float64
		}
		Meshes []struct {
			Primitives []struct{ Attributes map[string]int }
		}
		Accessors []struct {
			ComponentType int
			Normalized    bool
			Max           []float64
		}
	}
	if err := json.Unmarshal(b[20:20+int(binary.LittleEndian.Uint32(b[12:16]))], &doc); err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	if len(doc.Nodes) != 1 || doc.Nodes[0].Rotation != nil || doc.Nodes[0].Matrix != nil {
		t.Fatalf("%s: not one node with only a scale and a translation", file)
	}
	a := doc.Accessors[doc.Meshes[doc.Nodes[0].Mesh].Primitives[0].Attributes["POSITION"]]
	y := a.Max[1]
	if a.Normalized {
		y /= map[int]float64{5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a.ComponentType]
	}
	if s := doc.Nodes[0].Scale; s != nil {
		y *= s[1]
	}
	if tr := doc.Nodes[0].Translation; tr != nil {
		y += tr[1]
	}
	return y
}
