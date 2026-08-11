package service

type Speaker interface {
	Speak() string
}

type Greeter struct{}

func BuildMessage() string {
	return "hello"
}

func (Greeter) Speak() string {
	return BuildMessage()
}
