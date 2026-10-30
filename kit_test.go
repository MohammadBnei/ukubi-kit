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
	for _, c := range []string{"Idle", "Walking_A", "Interact", "Running_A", "Sit_Chair_Idle"} {
		if !slices.Contains(m.Clips.Names, c) {
			t.Errorf("clips: no %s in %v", c, m.Clips.Names)
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
	if v, _, _ := m.PickFor("guard", "defence", 2, "x", []string{"gate"}); v != "recipe/gatehouse" {
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
