// Package ukubikit is the game's 3D kit (plan/13 §5 in the game's design): CC0 models, repainted into civ styles,
// and the catalog that says which model a civ draws for a role in an age. It embeds dist/, which tools/build.mjs
// writes and CI checks is current.
package ukubikit

import (
	"embed"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io/fs"
	"slices"
)

//go:embed dist
var dist embed.FS

// FS is dist/ as a file system: manifest.json, models/…, styles/….
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // dist is embedded: it is always there
	}
	return sub
}

// Manifest is dist/manifest.json.
type Manifest struct {
	Kits      map[string]Kit               `json:"kits"`
	Models    map[string]Model             `json:"models"`
	Styles    map[string]map[string]string `json:"styles"` // style -> kit -> texture file
	Civs      map[string]Civ               `json:"civs"`
	States    map[string][]string          `json:"states"` // scaffold, stages -> model ids (shared by every civ)
	RoleNames []string                     `json:"roles"`  // every role a building can have
	Shapes    []string                     `json:"shapes"` // the shape vocabulary (catalog/shapes.yaml)
	// Characters are the town's people (kits/adventurers): skinned, one draw each, on the one rig Clips animates.
	// Which character plays which unit is the game's, never the kit's.
	Characters map[string]Character `json:"characters"`
	Clips      *Clips               `json:"clips"`
}

// Character is one skinned model: its body, its hat and cape baked into the skin, nothing held.
type Character struct {
	Kit     string  `json:"kit"`
	File    string  `json:"file"`
	Texture string  `json:"texture"` // its own image (characters are no civ's: no style paints them)
	Bytes   int     `json:"bytes"`
	SHA256  string  `json:"sha256"`
	Tris    int     `json:"tris"`
	Height  float64 `json:"height"` // standing, in the model's units
}

// Clips is the one clip file every character plays: the rig's nodes and the named clips.
type Clips struct {
	Kit    string   `json:"kit"`
	File   string   `json:"file"`
	Bytes  int      `json:"bytes"`
	SHA256 string   `json:"sha256"`
	Names  []string `json:"names"`
	Joints int      `json:"joints"`
}

type Kit struct {
	Repo      string  `json:"repo,omitempty"`      // a fetched pack, at Commit
	Commit    string  `json:"commit,omitempty"`    //
	Generator string  `json:"generator,omitempty"` // or a kit of our own, made by the build
	Licence   string  `json:"licence"`
	People    bool    `json:"characters,omitempty"` // a character kit: no civ draws it, no style paints it
	Scale     float64 `json:"scale"`
	Turns     int     `json:"turns"` // the turns its models take about +y: 6 (a hex), 4 (a square), 2 (one front)
}

type Model struct {
	Kit    string     `json:"kit"`
	File   string     `json:"file"`
	Bytes  int        `json:"bytes"`
	SHA256 string     `json:"sha256"`
	Tris   int        `json:"tris"`
	Size   [3]float64 `json:"size"`
	Reach  float64    `json:"reach"` // the farthest vertex, in hexes (1 = the hex's own edge)
}

// Civ is a civ as the kit draws it: from one kit only, per role the model per age, and its biome (the plot under
// its buildings, if its kit has one, and its dressing's seeded variants).
type Civ struct {
	Kit    string                `json:"kit"`
	Styles []string              `json:"styles"`           // one per age
	Roles  map[string][][]string `json:"roles"`            // role -> age -> variants
	Shapes map[string]string     `json:"shapes,omitempty"` // variant -> its shape (catalog/shapes.yaml), for the tagged ones
	Plot   string                `json:"plot,omitempty"`
	Dress  []string              `json:"dress"`
}

// Default is the town's own civ (the town centre) and an unknown civ's.
const Default = "default"

// Product is the role a civ draws for a role it doesn't list.
const Product = "product"

// Load reads the embedded manifest.
func Load() (*Manifest, error) {
	b, err := fs.ReadFile(FS(), "manifest.json")
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("ukubikit: manifest.json: %w", err)
	}
	return &m, nil
}

// Ages is how many ages every civ has.
func (m *Manifest) Ages() int { return len(m.Civs[Default].Styles) }

// Civ is the civ the kit draws for name: itself, or the default civ for a civ it doesn't know.
func (m *Manifest) Civ(name string) Civ {
	if c, ok := m.Civs[name]; ok {
		return c
	}
	return m.Civs[Default]
}

// Pick is what a building draws: the model for its role in its civ at age (1-based; clamped into the ages), a
// variant chosen by a hash of seed (the building's id, so it never changes), and the style that paints it. A civ
// draws from its own kit only: a role it doesn't list draws its product. An unknown civ is the default civ. ok is
// false for a role the kit doesn't know.
func (m *Manifest) Pick(civ, role string, age int, seed string) (model, style string, ok bool) {
	return m.PickFor(civ, role, age, seed, nil)
}

// PickFor is Pick for a building that asks for shapes (plan/13 §1: its model derived from what it is): it draws among
// the slot's variants carrying one of them, else among its untagged variants, else among all, so it is always drawn.
// Asking for none draws among the untagged variants: a tagged variant waits for a building that asks for its shape.
func (m *Manifest) PickFor(civ, role string, age int, seed string, shapes []string) (model, style string, ok bool) {
	if !slices.Contains(m.RoleNames, role) {
		return "", "", false
	}
	c := m.Civ(civ)
	style = m.Style(civ, age)
	slots := c.Roles[role]
	if slots == nil {
		slots = c.Roles[Product]
	}
	if len(slots) == 0 {
		return "", "", false
	}
	vs := slots[min(max(age, 1), len(slots))-1]
	if len(vs) == 0 {
		return "", "", false
	}
	var asked, untagged []string
	for _, v := range vs {
		switch s, tagged := c.Shapes[v]; {
		case tagged && slices.Contains(shapes, s):
			asked = append(asked, v)
		case !tagged:
			untagged = append(untagged, v)
		}
	}
	if len(asked) > 0 {
		vs = asked
	} else if len(untagged) > 0 {
		vs = untagged
	}
	// rendezvous hashing: each variant scores hash(seed, variant), the highest wins; adding a variant moves only the
	// buildings that now score it highest, never reshuffles the rest
	best, top := "", uint32(0)
	for _, v := range vs {
		h := fnv.New32a()
		h.Write([]byte(seed))
		h.Write([]byte{0})
		h.Write([]byte(v))
		if s := h.Sum32(); best == "" || s > top {
			best, top = v, s
		}
	}
	return best, style, true
}

// Style is a civ's style at age (1-based, clamped); an unknown civ has the default civ's.
func (m *Manifest) Style(civ string, age int) string {
	c := m.Civ(civ)
	if len(c.Styles) == 0 {
		return ""
	}
	return c.Styles[min(max(age, 1), len(c.Styles))-1]
}

// Turns is how many ways a model may face (its kit's turns about +y), 1 for a model the kit doesn't have.
func (m *Manifest) Turns(model string) int {
	if t := m.Kits[m.Models[model].Kit].Turns; t > 0 {
		return t
	}
	return 1
}

// Roles is every role a building can have, sorted.
func (m *Manifest) Roles() []string {
	out := slices.Clone(m.RoleNames)
	slices.Sort(out)
	return out
}
